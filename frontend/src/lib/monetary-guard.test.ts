// ============================================================================
// TSH Synergy AR — Monetary rendering static guard (B9DD-FEIR-006 §10, FEIR-011 §6)
//
// The PRIMARY guard is the type system: `formatMoney(amount, currency)` and
// `formatMoneySafe(amount, currency)` both take the currency as a REQUIRED
// parameter, so a codeless monetary render is a compile error, and the old
// default-MYR `formatCurrency(amount, currency = "MYR")` no longer exists.
//
// This focused static check backs that up for the patterns a type cannot catch —
// a re-introduced runtime MYR fallback, a cross-currency reduce, a first-row
// currency assumption, or a fake "all rows" page size. It scans real source
// files, so a regression fails the test suite rather than review.
// ============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import ts from "typescript";

const SRC = path.resolve(__dirname, "..");

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

/** Production source files (tests and the test harness are excluded). */
const SOURCE_FILES = walk(SRC).filter(
  (f) => !/\.test\.(ts|tsx)$/.test(f) && !f.includes(`${path.sep}test${path.sep}`),
);

/** `.tsx` must be parsed as TSX; `.ts` as TS. Wrong variant = wrong tokens. */
function scriptKindFor(fileName: string): ts.ScriptKind {
  return fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/** Parse with the real TypeScript parser, with parent pointers for traversal. */
export function parseSource(src: string, fileName = "efficacy.tsx"): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    src,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKindFor(fileName),
  );
}

/**
 * Remove comments using the TypeScript PARSER, not a hand-rolled scanner.
 *
 * B9DD-DR-002. The previous implementation was a character scanner that modelled
 * strings and templates but NOT regex literals — and a regex literal may legally
 * contain raw comment delimiters:
 *
 *     const slash = /[//]/;      // `//` is a character class, not a comment
 *     const star  = /[/*]/;      // `/*` is a character class, not a comment
 *
 * On the second case the old scanner saw an unterminated block comment and
 * deleted THE ENTIRE REST OF THE FILE (`const r = /[/*]/; ...` reduced to
 * `const r = /[ `), so every later line — including any real violation — left
 * the scan silently. That is a FALSE NEGATIVE: the guard under-scans and passes.
 * The previous claim that regex literals could only cause over-scanning was
 * simply wrong, and is retracted here.
 *
 * Disambiguating `/` (divide) from `/` (regex start) is context-dependent and
 * cannot be done by a lexer alone — it needs a parser. So we use the one already
 * in the repo (typescript 5.9, a devDependency; no new dependency). Comments are
 * TRIVIA to the parser, so they are identified with full grammatical context and
 * regex literals are single `RegularExpressionLiteral` tokens that can never
 * open a comment.
 *
 * Comment characters are replaced with SPACES rather than deleted, which:
 *   • keeps every other byte at its original offset, so real code is untouched
 *     and inter-token spacing (e.g. `rows.reduce((`) survives exactly;
 *   • prevents `a/*x*​/b` from fusing into the identifier `ab`.
 *
 * Strings, templates and regex bodies are deliberately PRESERVED: `const c =
 * "MYR"` is a real runtime value and must stay visible to the guard.
 */
export function stripComments(src: string, fileName = "efficacy.tsx"): string {
  const sourceFile = parseSource(src, fileName);
  const chars = src.split("");
  const seen = new Set<string>();

  const blank = (ranges: ts.CommentRange[] | undefined) => {
    for (const r of ranges ?? []) {
      const key = `${r.pos}:${r.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      for (let i = r.pos; i < r.end && i < chars.length; i += 1) {
        // Keep newlines so line-oriented raw checks stay meaningful.
        if (chars[i] !== "\n") chars[i] = " ";
      }
    }
  };

  const visit = (node: ts.Node) => {
    // JSX text is CONTENT, not code: `<p>https://x</p>` has no trivia, and
    // asking for comment ranges at its start would misread the `//`.
    if (node.kind !== ts.SyntaxKind.JsxText) {
      blank(ts.getLeadingCommentRanges(src, node.getFullStart()));
      blank(ts.getTrailingCommentRanges(src, node.getEnd()));
    }
    // getChildren() (unlike forEachChild) includes punctuation tokens, so an
    // inline comment before `)` or `}` is covered too.
    for (const child of node.getChildren(sourceFile)) visit(child);
  };
  visit(sourceFile);

  return chars.join("");
}

/** Parser-stripped, whitespace-normalized whole-file code text. */
export function normalizeSource(src: string, fileName = "efficacy.tsx"): string {
  return stripComments(src, fileName).replace(/\s+/g, " ");
}

/**
 * Every piece of STATIC string text in real code, via the AST.
 *
 * B9DD-MDR-003 §7.1: the previous visitor collected only `StringLiteral` and
 * `NoSubstitutionTemplateLiteral`, so it saw `` `MYR` `` but MISSED every
 * interpolated template — `` `MYR${x}` ``, `` `${p}MYR${s}` `` and
 * `` `${p}MYR` `` all passed the guard. Those are `TemplateExpression`s whose
 * static text lives in `head` (TemplateHead) and in each span's `literal`
 * (TemplateMiddle / TemplateTail), none of which the visitor visited.
 *
 * An AST walk distinguishes a literal from a comment, from JSX text and from a
 * regex body structurally — no pattern matching, nothing to bypass by
 * formatting. A regex body is a `RegularExpressionLiteral`, never a string, so
 * `/MYR/` is correctly NOT treated as a runtime string value.
 */
function staticStringText(sourceFile: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      out.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      // `head` is the text before the first ${...}; each span's `literal` is the
      // text between/after them. Collected individually so a code point split
      // across an interpolation is never falsely joined.
      out.push(node.head.text);
      for (const span of node.templateSpans) out.push(span.literal.text);
    } else if (ts.isJsxText(node)) {
      // B9DD-CDR-003 §5: JSX text is rendered STATIC TEXT — `<span>MYR</span>`
      // puts MYR on the user's screen just as surely as a string literal, and the
      // previous visitor never looked at it. `JsxText` is its own node kind, so
      // it was invisible to a walk that only tested string/template nodes.
      //
      // Whitespace is normalized for INSPECTION only (JSX text carries the
      // source's newlines and indentation, so a multi-line `<p>\n  MYR\n</p>`
      // would otherwise read as "\n  MYR\n"). Each JsxText node is pushed
      // SEPARATELY and never joined with its siblings: concatenating
      // `<>{a}MY{b}R</>` would fabricate an "MYR" token that no user ever sees.
      const text = node.text.replace(/\s+/g, " ").trim();
      if (text !== "") out.push(text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}

// ── B9DD-MDR-003 §7.2: structural monetary-reduction detection ──────────────

/**
 * The governed monetary field set. Summing any of these across rows in the
 * browser is prohibited: a same-currency subtotal must go through
 * `sumByCurrency`, and a company-base total must come from the backend.
 */
const MONETARY_FIELDS = new Set([
  "outstanding",
  "total_amount",
  "receipt_amount",
  "allocated_amount",
  "base_total",
  "amount",
]);

/**
 * Strip the wrappers that hide a property access from a regex but change
 * nothing semantically: parentheses, `as T`, `<T>x`, `!`, and `Number(x)`.
 *
 * This is why the old rule missed `row?.outstanding` and friends — each
 * spelling needed its own pattern, and there are more spellings than patterns.
 */
function unwrapExpression(node: ts.Expression): ts.Expression {
  let current: ts.Expression = node;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) { current = current.expression; continue; }
    if (ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)) { current = current.expression; continue; }
    if (ts.isNonNullExpression(current)) { current = current.expression; continue; }
    if (ts.isSatisfiesExpression(current)) { current = current.expression; continue; }
    // Numeric coercion wrappers: Number(x) / parseFloat(x) / +x are still the
    // same monetary read.
    if (
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      (current.expression.text === "Number" || current.expression.text === "parseFloat") &&
      current.arguments.length === 1
    ) {
      current = current.arguments[0];
      continue;
    }
    if (ts.isPrefixUnaryExpression(current) && current.operator === ts.SyntaxKind.PlusToken) {
      current = current.operand;
      continue;
    }
    return current;
  }
}

/** The property name an access reads, for every access spelling TS allows. */
function accessedPropertyName(node: ts.Expression): string | null {
  const expr = unwrapExpression(node);
  // row.outstanding  /  row?.outstanding  (both PropertyAccessExpression)
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  // row["outstanding"]  /  row?.["outstanding"]  (both ElementAccessExpression)
  if (ts.isElementAccessExpression(expr)) {
    const arg = expr.argumentExpression;
    if (ts.isStringLiteralLike(arg)) return arg.text;
  }
  return null;
}

/**
 * Does this expression tree read a protected monetary value?
 *
 * B9DD-CDR-003 §4.2. Recurses through every wrapper and fallback that changes
 * the SYNTAX but not the fact that a protected field was read:
 *
 *   `row.outstanding`, `row?.outstanding`, `row["outstanding"]`,
 *   `row?.["outstanding"]`, `(row as Row).outstanding`, `row!.outstanding`,
 *   `Number(row?.outstanding)`, `row?.outstanding ?? 0`, `row?.outstanding || 0`,
 *   `Number(row?.outstanding ?? 0)`, `cond ? row.outstanding : 0`
 *
 * `tainted` carries callback-local variables already known to hold a protected
 * value (§4.3), so `const v = row.outstanding; return sum + v` is caught too.
 */
function expressionContainsProtectedMonetaryValue(
  node: ts.Expression,
  tainted: ReadonlySet<string>,
): boolean {
  const expr = unwrapExpression(node);

  // A callback-local identifier that we already know holds a monetary read.
  if (ts.isIdentifier(expr) && tainted.has(expr.text)) return true;

  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    // Fallbacks and arithmetic both PROPAGATE the protected value.
    // `a + b` on strings is concatenation and deliberately not our business,
    // but `??`/`||`/`&&` around a monetary read still yield that read.
    if (
      op === ts.SyntaxKind.QuestionQuestionToken ||
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.AmpersandAmpersandToken ||
      op === ts.SyntaxKind.PlusToken ||
      op === ts.SyntaxKind.MinusToken ||
      op === ts.SyntaxKind.AsteriskToken ||
      op === ts.SyntaxKind.SlashToken
    ) {
      return (
        expressionContainsProtectedMonetaryValue(expr.left, tainted) ||
        expressionContainsProtectedMonetaryValue(expr.right, tainted)
      );
    }
    return false;
  }

  // `cond ? row.outstanding : 0` — either branch is a monetary read.
  if (ts.isConditionalExpression(expr)) {
    return (
      expressionContainsProtectedMonetaryValue(expr.whenTrue, tainted) ||
      expressionContainsProtectedMonetaryValue(expr.whenFalse, tainted)
    );
  }

  const name = accessedPropertyName(expr);
  return name !== null && MONETARY_FIELDS.has(name);
}

/**
 * Collect the protected bindings introduced by a reducer's ROW parameter.
 *
 * §4.1. `(sum, { outstanding })` and `(sum, { outstanding: value })` never read
 * a property at all — the field is destructured straight into scope — so a
 * property-access-based check saw nothing. Returns the local names that are
 * therefore already tainted.
 */
function destructuredProtectedNames(param: ts.ParameterDeclaration): string[] {
  const out: string[] = [];
  if (!ts.isObjectBindingPattern(param.name)) return out;
  for (const element of param.name.elements) {
    // `propertyName` is set only when aliased: `{ outstanding: value }` has
    // propertyName=outstanding, name=value. Plain `{ outstanding }` has
    // propertyName=undefined and name=outstanding.
    const sourceName =
      element.propertyName && ts.isIdentifier(element.propertyName)
        ? element.propertyName.text
        : ts.isIdentifier(element.name)
          ? element.name.text
          : null;
    if (sourceName === null || !MONETARY_FIELDS.has(sourceName)) continue;
    if (ts.isIdentifier(element.name)) out.push(element.name.text);
  }
  return out;
}

/**
 * Find `.reduce(...)` / `.reduceRight(...)` callbacks that arithmetically
 * aggregate a protected monetary value across rows.
 *
 * BOUNDED, and the boundary is stated rather than implied (§4.3):
 *
 *   - Analysis is confined to a SINGLE reducer callback body. Callback-local
 *     `const`/`let` bindings are tracked; nothing outside is.
 *   - Calls to arbitrary helpers are NOT followed. `sum + toNumber(row)` is not
 *     flagged. Whole-program/interprocedural analysis is explicitly out of
 *     scope, so this is a strong guard against the realistic accidental cases,
 *     NOT a proof of absence against a determined author.
 *   - Nested function bodies are not traversed (§4.5), so a protected read
 *     inside an unrelated inner callback is not misattributed to the reducer.
 */
function monetaryReduceCallbacks(sourceFile: ts.SourceFile): ts.Node[] {
  const hits: ts.Node[] = [];

  const callbackAggregates = (cb: ts.ArrowFunction | ts.FunctionExpression): boolean => {
    // ── §4.1: parameter binding ───────────────────────────────────────────
    const accumulatorParam = cb.parameters[0];
    const rowParam = cb.parameters[1];
    const accumulatorName =
      accumulatorParam && ts.isIdentifier(accumulatorParam.name) ? accumulatorParam.name.text : null;

    // Seed taint with anything destructured out of the row parameter.
    const tainted = new Set<string>(rowParam ? destructuredProtectedNames(rowParam) : []);
    // The accumulator itself holds the running monetary total.
    const accumulators = new Set<string>(accumulatorName ? [accumulatorName] : []);

    const isProtected = (e: ts.Expression) => expressionContainsProtectedMonetaryValue(e, tainted);

    /** `sum + protected` / `protected + sum` / any `+` tree containing one. */
    const addsProtected = (e: ts.Expression): boolean => {
      const expr = unwrapExpression(e);
      if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        return isProtected(expr.left) || isProtected(expr.right);
      }
      return false;
    };

    /**
     * Does this expression MUTATE the accumulator with a protected value?
     *
     * B9DD-CRR-003 §3.1. `sum += x` and `sum = sum + x` are assignment
     * EXPRESSIONS, not statements — so `return (sum += row.outstanding)` is a
     * perfectly ordinary reducer that the previous visitor missed entirely: it
     * tested returns with `addsProtected`, which requires a top-level `+`, and an
     * assignment is not a `+`.
     *
     * Written as ONE helper used by every position (§3.2) rather than as
     * position-specific logic, so statement form and return form cannot drift
     * apart again.
     *
     * The left-hand side must be the accumulator parameter or a tracked alias —
     * that is what keeps `row.count += 1` and `sum += row.quantity` clean.
     */
    const expressionMutatesAccumulatorWithProtectedValue = (e: ts.Expression): boolean => {
      // Unwrap transparent wrappers around the WHOLE expression:
      // `(sum += x) as number`, `Number(sum += x)`, `((sum += x))`, `+(sum += x)`.
      const expr = unwrapExpression(e);
      if (!ts.isBinaryExpression(expr)) return false;

      const target = unwrapExpression(expr.left);
      // Only a bare identifier can be the accumulator. `row.count += 1` and
      // `acc[row.currency] = ...` are property/element writes, not accumulator
      // mutation, and must stay clean.
      if (!ts.isIdentifier(target)) return false;
      if (!accumulators.has(target.text)) return false;

      switch (expr.operatorToken.kind) {
        // `sum += protected`
        case ts.SyntaxKind.PlusEqualsToken:
          return isProtected(expr.right);
        // `sum = sum + protected` / `sum = protected + sum` (either operand
        // order; both are the same aggregation).
        case ts.SyntaxKind.EqualsToken:
          return addsProtected(expr.right);
        default:
          return false;
      }
    };

    // ── Concise arrow body: `(s, row) => s + row.outstanding` ─────────────
    if (!ts.isBlock(cb.body)) return addsProtected(cb.body);

    // ── Block body: bounded statement walk in source order ────────────────
    //
    // Deliberately iterative over the callback's OWN statements (§4.5): we do
    // not recurse into nested function bodies, so an inner callback's monetary
    // read is not attributed to this reducer.
    let found = false;

    const noteTaint = (name: string, init: ts.Expression | undefined) => {
      if (!init) return;
      if (isProtected(init)) tainted.add(name);
      // An accumulator alias: `let a = sum;` keeps a tracking the running total.
      const un = unwrapExpression(init);
      if (ts.isIdentifier(un) && accumulators.has(un.text)) accumulators.add(name);
    };

    const walkStatements = (statements: readonly ts.Statement[]) => {
      for (const stmt of statements) {
        if (found) return;

        // `const v = row.outstanding;` / `let v;` / `const { outstanding } = row;`
        if (ts.isVariableStatement(stmt)) {
          for (const decl of stmt.declarationList.declarations) {
            if (ts.isIdentifier(decl.name)) {
              noteTaint(decl.name.text, decl.initializer);
              // `const next = sum + row.outstanding; return next;`
              if (decl.initializer && addsProtected(decl.initializer)) {
                tainted.add(decl.name.text);
                accumulators.add(decl.name.text);
              }
              // §3.2: `const next = (sum += row.outstanding);` mutates the
              // accumulator in an initializer position. Same helper, so this
              // position cannot drift from the statement/return forms.
              if (decl.initializer && expressionMutatesAccumulatorWithProtectedValue(decl.initializer)) {
                found = true;
                return;
              }
            } else if (ts.isObjectBindingPattern(decl.name) && decl.initializer) {
              // `const { outstanding } = row;` / `const { outstanding: v } = row;`
              for (const element of decl.name.elements) {
                const sourceName =
                  element.propertyName && ts.isIdentifier(element.propertyName)
                    ? element.propertyName.text
                    : ts.isIdentifier(element.name)
                      ? element.name.text
                      : null;
                if (sourceName && MONETARY_FIELDS.has(sourceName) && ts.isIdentifier(element.name)) {
                  tainted.add(element.name.text);
                }
              }
            }
          }
          continue;
        }

        // `sum += row.outstanding;` / `v = row?.outstanding ?? 0;` / `a = a + v;`
        if (ts.isExpressionStatement(stmt) && ts.isBinaryExpression(stmt.expression)) {
          const bin = stmt.expression;
          // §3.2: the SAME helper as the return form.
          if (expressionMutatesAccumulatorWithProtectedValue(bin)) { found = true; return; }
          // Any LOCAL that receives a protected value becomes tainted — by `=`
          // or by `+=` alike. This is load-bearing, not tidiness: restricting
          // the mutation rule to the accumulator would otherwise let
          // `let x = 0; x += row.outstanding; return sum + x` launder the value
          // through an untracked local. `v = row.outstanding` and
          // `v += row.outstanding` both aggregate nothing on their own; they
          // only matter once `v` reaches the accumulator, which the tainted set
          // is what detects.
          const target = unwrapExpression(bin.left);
          const op = bin.operatorToken.kind;
          if (
            ts.isIdentifier(target) &&
            (op === ts.SyntaxKind.EqualsToken || op === ts.SyntaxKind.PlusEqualsToken) &&
            isProtected(bin.right)
          ) {
            tainted.add(target.text);
          }
          continue;
        }

        // `return sum + row.outstanding;` / `return next;` / `return (sum += x);`
        if (ts.isReturnStatement(stmt)) {
          if (stmt.expression && addsProtected(stmt.expression)) { found = true; return; }
          // §3.3: `return (sum += protected)` / `return (sum = sum + protected)`,
          // including through assertions and Number(...) wrappers.
          if (stmt.expression && expressionMutatesAccumulatorWithProtectedValue(stmt.expression)) {
            found = true;
            return;
          }
          // `const next = sum + protected; return next;` — next is a tainted
          // accumulator, so returning it returns the aggregate.
          if (stmt.expression) {
            const un = unwrapExpression(stmt.expression);
            if (ts.isIdentifier(un) && tainted.has(un.text) && accumulators.has(un.text)) {
              found = true;
              return;
            }
          }
          continue;
        }

        // Control flow: descend into the branches' statements only.
        if (ts.isIfStatement(stmt)) {
          const branches = [stmt.thenStatement, stmt.elseStatement].filter(Boolean) as ts.Statement[];
          for (const b of branches) walkStatements(ts.isBlock(b) ? b.statements : [b]);
          continue;
        }
        if (ts.isBlock(stmt)) {
          walkStatements(stmt.statements);
          continue;
        }
      }
    };

    walkStatements(cb.body.statements);
    return found;
  };

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      // §4.4: both fold directions. `reduceRight` is the same operation with the
      // same monetary consequence, and it was simply not in the old name check.
      // §4.4 also: do NOT classify unrelated methods as reduce — exact match only.
      if ((method === "reduce" || method === "reduceRight") && node.arguments.length > 0) {
        const cb = node.arguments[0];
        if ((ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) && callbackAggregates(cb)) {
          hits.push(node);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return hits;
}

/**
 * Scan production source as WHOLE, comment-stripped, whitespace-normalized text.
 *
 * B9DD-FR-004: the previous implementation split on "\n" and tested each line
 * independently, so every pattern here was bypassable purely by formatting —
 * `currency:\n  "MYR"` matched nothing at all. Prettier or a merge could have
 * silently disarmed the guard. Normalizing the entire file first means line
 * breaks, indentation and interleaved comments are all irrelevant to a match.
 *
 * The trade-off is line numbers: a whole-file scan cannot honestly attribute a
 * match to a line, so hits report the FILE, which is what the assertions and the
 * allow-lists are keyed on anyway. A file path is enough to find a violation;
 * a fabricated line number would be worse than none.
 *
 * Patterns are matched with `.test()` on a fresh string each call and no `/g`
 * flag is used anywhere in PATTERNS, so there is no `lastIndex` state to leak
 * between files (the classic global-regex bug).
 */
function scan(pattern: RegExp, options: { allow?: (file: string) => boolean } = {}) {
  if (pattern.global || pattern.sticky) {
    throw new Error(`Guard pattern must not be /g or /y (lastIndex state): ${pattern}`);
  }
  const hits: string[] = [];
  for (const file of SOURCE_FILES) {
    if (options.allow?.(file)) continue;
    if (pattern.test(normalizedProduction(file))) hits.push(path.relative(SRC, file));
  }
  return hits;
}

/** Parse + strip + normalize a production file once, then cache it. */
const normalizedCache = new Map<string, string>();
function normalizedProduction(file: string): string {
  let cached = normalizedCache.get(file);
  if (cached === undefined) {
    // The real file name is passed through, so `.tsx` is parsed as TSX.
    cached = normalizeSource(readFileSync(file, "utf8"), file);
    normalizedCache.set(file, cached);
  }
  return cached;
}

/**
 * As `scan`, but reports a surrounding window of normalized code per match, for
 * the few checks that must judge a match by its CONTEXT (e.g. `as any` only
 * matters around a monetary response). Building the /g regex fresh per call
 * keeps `lastIndex` from leaking between files.
 */
function scanSnippets(
  pattern: RegExp,
  options: { allow?: (file: string) => boolean; window?: number } = {},
) {
  const width = options.window ?? 70;
  const hits: string[] = [];
  for (const file of SOURCE_FILES) {
    if (options.allow?.(file)) continue;
    const normalized = normalizedProduction(file);
    const g = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, "") + "g");
    for (const m of normalized.matchAll(g)) {
      const at = m.index ?? 0;
      const snippet = normalized.slice(Math.max(0, at - width), at + m[0].length + width);
      hits.push(`${path.relative(SRC, file)}: …${snippet}…`);
    }
  }
  return hits;
}

/**
 * Scan the RAW file, comments included.
 *
 * Encoding damage and leaked secrets are defects wherever they appear — a
 * mojibake'd comment is still mojibake, and a key pasted into a comment is still
 * a key. These checks therefore deliberately do NOT strip comments.
 */
function scanRaw(pattern: RegExp) {
  return SOURCE_FILES.filter((file) => pattern.test(readFileSync(file, "utf8"))).map((f) =>
    path.relative(SRC, f),
  );
}

/**
 * The ONLY files permitted to contain MYR literals.
 *
 * Narrow and explicit by design (B9DD-RR-006 §9.1):
 *   • lib/currency.ts — the supported-currency allow-list and its display labels.
 * Test files and the harness are already excluded from SOURCE_FILES.
 */
const MYR_POLICY_FILES = [path.join("lib", "currency.ts")];
const isMyrPolicyFile = (file: string) => MYR_POLICY_FILES.some((p) => file.endsWith(p));

/**
 * The ONLY static strings outside the policy module that may mention MYR.
 *
 * Reviewed individually and allow-listed by EXACT TEXT, not by file: any other
 * MYR-bearing string anywhere still fails, so the catch-all keeps its full
 * force. Both are user-facing help text about which code to type — neither is a
 * currency VALUE, a default, or a label on an amount.
 *
 * B9DD-MDR-003 §7.1 note: these surfaced only once the literal check became an
 * AST substring check over all template forms. The previous regex required
 * quote-MYR-quote adjacency, so MYR inside a longer sentence never matched.
 * They are pre-existing text, not new violations.
 */
const JUSTIFIED_MYR_TEXT = new Set([
  // invoices/import/page.tsx — accurately documents REAL backend behaviour:
  // imports/service.ts (~1847, ~1911, ~1973) defaults an imported document's
  // currency to MYR. Deleting this would make the help text wrong.
  "3-letter ISO code (default: MYR)",
  // use-ocr-import.ts — MYR appears only as one of two worked examples of the
  // ISO format the reviewer should type.
  "3-letter ISO code (e.g. SGD, MYR)",
]);

/**
 * The forbidden patterns, named — so the guard can be verified against the
 * ACTUAL pre-remediation source lines (see "guard efficacy" below).
 *
 * A guard that cannot fail proves nothing: every pattern here is asserted to
 * match a real line that existed before this batch's remediation.
 */
const PATTERNS = {
  myrFallback: /(\?\?|\|\|)\s*["']MYR["']/,
  myrDefaultParam: /=\s*["']MYR["']\s*[,)]/,
  myrParity: /currency\s*[!=]==\s*["']MYR["']/i,
  // `\s*` around the colon: a formatter may legally break `currency:` from its
  // value, and the guard must not care (B9DD-FR-004).
  myrInitializer: /currency\s*:\s*["']MYR["']/i,
  myrAssignment: /currency\s*=\s*["']MYR["']/i,
  myrBaseLabel: /Base\s+(Currency|Total|Amount)\s*\(\s*MYR\s*\)/i,
  myrLiteral: /["']MYR["']/,
  fakeAllPageSize: /page_size:\s*(?!(?:[1-9]|[1-9][0-9]|100)\b)\d+/,
  forcedTotalPages: /totalPages\s*=\s*1\s*;/,
  fakeAllHook: /export\s+function\s+useAll[A-Z]\w*/,
  // Bounded deliberately: under a WHOLE-FILE scan (B9DD-FR-004) an unbounded
  // `[^;]*` would happily span hundreds of lines of unrelated JSX — which has
  // few semicolons — and manufacture a false positive. The window is wide enough
  // for any real single expression and no wider.
  falseZeroExposure: /(exposure|outstanding|aging|amount|balance|money)Map\s*\.\s*get\s*\([^;{}]{0,80}\?\?\s*0/i,
  firstRowCurrency: /\[0\]\?\.(receipt_currency|currency|base_currency)/,
  impossibleImportSource: /["']csv_xlsx_import["']/,
  // Matches `mappedData.source`, `mapped_data?.source` and `mappedData["source"]`
  // with no unbounded gap between the object and the property.
  mappedDataOrigin:
    /mapped_?[Dd]ata\s*(?:\?\s*)?\.\s*source\b|mapped_?[Dd]ata\s*(?:\?\.)?\s*\[\s*["']source["']\s*\]/,
  crossCurrencyReduce:
    /\.reduce\(\s*\([^)]*\)\s*=>\s*[a-z]+\s*\+\s*(?:Number\()?[a-z]+\.(outstanding|total_amount|receipt_amount|allocated_amount|base_total|amount)\b/i,
} as const;

describe("monetary static guard", () => {
  it("has no runtime MYR fallback in any production path", () => {
    // `?? "MYR"` / `|| "MYR"` silently mislabels a foreign or company-base amount.
    expect(scan(PATTERNS.myrFallback)).toEqual([]);
  });

  it("has no default-MYR parameter in any function signature", () => {
    expect(scan(PATTERNS.myrDefaultParam)).toEqual([]);
  });

  it("does not branch on a hard-coded MYR to decide base parity", () => {
    // Base parity is `currency === companyBaseCurrency`, resolved from
    // authoritative company context — not a comparison against a literal.
    // Case-insensitive so `watchCurrency !== "MYR"` is caught too (B9DD-RR-003).
    expect(scan(PATTERNS.myrParity, { allow: isMyrPolicyFile })).toEqual([]);
  });

  // ── B9DD-RR-003: form/schema initializers ─────────────────────────────────

  it("has no `currency: \"MYR\"` initializer in any form or schema default", () => {
    // `defaultInvoiceValues()` / `defaultReceiptValues()` previously did exactly
    // this, so an SGD-base company started every document in the wrong currency.
    expect(scan(PATTERNS.myrInitializer, { allow: isMyrPolicyFile })).toEqual([]);
  });

  it("has no `currency = \"MYR\"` assignment default", () => {
    expect(scan(PATTERNS.myrAssignment, { allow: isMyrPolicyFile })).toEqual([]);
  });

  it("has no hard-coded MYR base label", () => {
    // e.g. "Base Currency (MYR)" / "Base Total (MYR)" — the label must name the
    // REAL base currency, which for another company is not MYR at all.
    expect(scan(PATTERNS.myrBaseLabel, { allow: isMyrPolicyFile })).toEqual([]);
  });

  it("has no MYR literal at all outside the currency-policy module", () => {
    // A catch-all backstop: any NEW MYR literal in production source must either
    // live in lib/currency.ts or be justified by extending this allow-list.
    //
    // B9DD-DR-002: this one is a true AST check — it asks the parser for every
    // piece of static TEXT in real code. That distinguishes real text from a
    // comment and from a regex body structurally, with no pattern matching and
    // nothing to bypass by formatting.
    // B9DD-MDR-003 §7.1: static text from EVERY template form is inspected —
    // head, middle and tail — so `MYR${suffix}` cannot slip past.
    // B9DD-CDR-003 §5: JSX text is now INSPECTED too, not skipped. `<span>MYR
    // </span>` is rendered text and was previously invisible here. Reviewed
    // outcome: this surfaced no production JSX text, so the exact-text allow-list
    // below still needs no JSX entry.
    const hits: string[] = [];
    for (const file of SOURCE_FILES) {
      if (isMyrPolicyFile(file)) continue;
      const sourceFile = parseSource(readFileSync(file, "utf8"), file);
      for (const text of staticStringText(sourceFile)) {
        // Allow-listed by EXACT text, so any other MYR string still fails.
        if (text.includes("MYR") && !JUSTIFIED_MYR_TEXT.has(text)) {
          hits.push(`${path.relative(SRC, file)}: ${text}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("keeps every justified MYR string genuinely present and non-monetary", () => {
    // The allow-list is only sound while the strings it excuses still exist and
    // still are what they claim to be. A stale entry would silently widen it.
    const allText = SOURCE_FILES.flatMap((file) =>
      staticStringText(parseSource(readFileSync(file, "utf8"), file)),
    );
    for (const justified of JUSTIFIED_MYR_TEXT) {
      expect(allText, `justified MYR string is stale: ${justified}`).toContain(justified);
      // Each is guidance about the ISO CODE FORMAT — never a value or a label
      // attached to an amount.
      expect(justified).toMatch(/3-letter ISO code/);
    }
  });

  it("parses every production file cleanly enough to inspect", () => {
    // B9DD-DR-002: the guard's authority rests on the parse. A file the parser
    // cannot make sense of must FAIL the guard rather than be quietly scanned
    // as a soup of tokens.
    const unparsable: string[] = [];
    for (const file of SOURCE_FILES) {
      const sourceFile = parseSource(readFileSync(file, "utf8"), file);
      // `parseDiagnostics` is internal but stable, and is the only way to see
      // grammar errors without a full Program. Absence of the field is treated
      // as "no diagnostics", never as a pass-by-accident.
      const diagnostics =
        (sourceFile as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
      if (diagnostics.length > 0) unparsable.push(path.relative(SRC, file));
    }
    expect(unparsable).toEqual([]);
  });

  it("no longer exports a default-MYR formatCurrency helper", () => {
    const utils = readFileSync(path.join(SRC, "lib", "utils.ts"), "utf8");
    expect(utils).not.toMatch(/export function formatCurrency/);
    // And nothing imports one from the old locations.
    expect(scan(/import\s*\{[^}]*\bformatCurrency\b[^}]*\}\s*from\s*["']@\/lib\/(utils|currency)["']/)).toEqual([]);
  });

  it("has no fake 'all rows' page size (the backend clamps to 100)", () => {
    expect(scan(PATTERNS.fakeAllPageSize)).toEqual([]);
  });

  it("does not force totalPages to a constant 1", () => {
    expect(scan(PATTERNS.forcedTotalPages)).toEqual([]);
  });

  // ── B9DD-RR-001 / RR-002: first-page-only "all" authorities ───────────────

  it("exports no first-page-only hook that presents itself as 'all'", () => {
    // `useAllCustomers` / `useAllInvoices` / `useAllReceipts` each fetched page 1
    // and were consumed as if complete. Any genuinely complete accessor must
    // page to exhaustion and is named for what it does (e.g. fetchCustomerAgingRow).
    expect(scan(PATTERNS.fakeAllHook)).toEqual([]);
  });

  it("never reads a monetary exposure map with a zero default", () => {
    // `outstandingMap.get(c.id)?.amount ?? 0` rendered a FALSE ZERO for any
    // customer absent from the first aging page. Absence must be an explicit
    // state, never the number zero.
    //
    // Scoped to MONETARY maps: a non-monetary default (e.g. a tax RATE of 0 in
    // use-invoice-calculator) is legitimate and deliberately not matched.
    expect(scan(PATTERNS.falseZeroExposure)).toEqual([]);
  });

  // ── B9DD-RR-005: import origin must not come from mapped_data ─────────────

  it("does not infer an import origin from mapped_data", () => {
    // Production never writes `csv_xlsx_import` into mapped_data.source at all
    // (imports/service.ts::importOriginPayload builds it at POSTING time for the
    // FX RPC), and never writes a bare `ocr`. The origin lives on the BATCH
    // envelope — import_type + file_type — which `GET /imports/:id` returns.
    //
    // Note "ocr" alone is NOT matched: it is a legitimate UI mode literal on the
    // import pages. What is forbidden is the impossible mapped_data source value
    // and any reading of an origin out of mapped_data.
    // Only the governance module may name it, and there only as the
    // `ImportOriginKind` discriminant resolved FROM the batch envelope.
    const allowed = (file: string) => file.endsWith(path.join("lib", "import-governance.ts"));
    expect(scan(PATTERNS.impossibleImportSource, { allow: allowed })).toEqual([]);

    // Only the governance reader may touch mapped_data.source, and only to
    // detect the one real marker ('ocr_manual_fallback').
    expect(scan(PATTERNS.mappedDataOrigin, { allow: allowed })).toEqual([]);
    expect(scan(/["']source["']/, { allow: allowed })).toEqual([]);
  });

  it("has no cross-currency reduce over money in pages or components", () => {
    // A same-currency sum must go through `sumByCurrency`; a company-base total
    // must come from the backend summary.
    //
    // B9DD-MDR-003 §7.2: this is a STRUCTURAL AST check, not a regex. The old
    // pattern matched only `row.outstanding` and missed `row?.outstanding`,
    // `row["outstanding"]`, `row?.["outstanding"]`, `(row as Row).outstanding`,
    // `row!.outstanding` and `Number(row?.outstanding)` — six spellings of the
    // same prohibited operation. Adding a seventh regex would have missed the
    // eighth; the AST covers them all by unwrapping to the access itself.
    //
    // The reviewed allow-list is preserved EXACTLY as before.
    const allowed = (file: string) =>
      file.endsWith(path.join("lib", "currency.ts")) ||
      file.endsWith(path.join("lib", "invoice-calculator.ts")) ||
      file.endsWith(path.join("hooks", "use-allocation-logic.ts")) ||
      file.endsWith(path.join("hooks", "use-receipts.ts"));

    const hits = SOURCE_FILES.filter((file) => {
      if (allowed(file)) return false;
      const sourceFile = parseSource(readFileSync(file, "utf8"), file);
      return monetaryReduceCallbacks(sourceFile).length > 0;
    }).map((f) => path.relative(SRC, f));

    expect(hits).toEqual([]);
  });

  it("does not derive a currency from the first row of a collection", () => {
    expect(scan(PATTERNS.firstRowCurrency)).toEqual([]);
    expect(scan(/\[0\]\.(receipt_currency|base_currency)/)).toEqual([]);
  });

  // ── B9DD-RR-003/004: codeless monetary rendering ──────────────────────────

  it("renders no monetary value through formatAmount without a currency in scope", () => {
    // `formatAmount` deliberately has NO currency parameter: it is a plain
    // number formatter. Using it for money is only defensible when the
    // surrounding UI states the currency (a column header, or a code prefix).
    //
    // Rather than guess at "nearby" context with a fragile regex, this asserts
    // an explicit, reviewed allow-list: every file that formats money with
    // `formatAmount` must be listed here WITH the reason it is safe. A new
    // usage anywhere else fails, which forces the decision through review.
    const JUSTIFIED: Record<string, string> = {
      [path.join("app", "(dashboard)", "invoices", "[id]", "page.tsx")]:
        "Line-item cells; every monetary column header names invoice.currency.",
      [path.join("components", "features", "invoices", "invoice-line-table.tsx")]:
        "Line-item cells; every monetary column header names the document currency.",
      [path.join("components", "features", "dashboard", "chart-tooltip.tsx")]:
        "Prefixes the currency code itself (`{code} {formatAmount(...)}`).",
      [path.join("lib", "utils.ts")]: "Defines formatAmount.",
    };

    const offenders = scan(/\bformatAmount\s*\(/).filter((file) => !(file in JUSTIFIED));

    expect(offenders).toEqual([]);
  });

  it("keeps every justified formatAmount file's currency context intact", () => {
    // The allow-list above is only sound while the stated context really exists.
    const headerFiles = [
      path.join("app", "(dashboard)", "invoices", "[id]", "page.tsx"),
      path.join("components", "features", "invoices", "invoice-line-table.tsx"),
    ];
    for (const rel of headerFiles) {
      const content = readFileSync(path.join(SRC, rel), "utf8");
      // A monetary column header must interpolate a currency, e.g.
      // `Line Total ({invoice.currency})` or `Line Amt {currencySuffix}`.
      expect(content, `${rel} must name its currency in the column headers`).toMatch(
        /(\(\{[\w.]*[Cc]urrency\}\)|\{currencySuffix\})/,
      );
    }
    const tooltip = readFileSync(
      path.join(SRC, "components", "features", "dashboard", "chart-tooltip.tsx"),
      "utf8",
    );
    expect(tooltip).toMatch(/code\s*\?/);
  });

  it("does not fetch a current/latest FX rate while rendering documents", () => {
    expect(scan(/\/fx-rates\/(latest|current)|latest_rate|current_rate/)).toEqual([]);
  });

  it("performs no direct Supabase financial-table mutation from the frontend", () => {
    expect(scan(/supabase\s*\.\s*from\(["'](invoices|receipts|allocations|journal_entries)["']\)/)).toEqual([]);
    expect(scan(/supabase\s*\.\s*rpc\(/)).toEqual([]);
  });

  it("keeps the disabled POST /allocations/auto endpoint disabled", () => {
    // Comments are stripped, so this asserts something stronger than before: no
    // production CODE references the endpoint at all — not in a URL, not in a
    // fetch, not in a string. The only mentions left are documentation.
    expect(scan(/allocations\s*\/\s*auto/)).toEqual([]);

    // And the deliberately-disabled hook must still refuse rather than call it.
    const hook = readFileSync(path.join(SRC, "hooks", "use-allocations.ts"), "utf8");
    expect(hook).toMatch(/Auto-allocation is not available/);
  });

  it("has no `as any` cast around a monetary or report response", () => {
    const hits = scanSnippets(/as any/).filter((h) =>
      /(summary|base_total|by_currency|rows|aging|invoice|receipt|amount|outstanding)/i.test(h),
    );
    expect(hits).toEqual([]);
  });

  it("contains no conflict markers or mojibake in source", () => {
    // Whole-file scan: the `^` line anchor is gone, so match the markers as
    // standalone tokens instead.
    expect(scanRaw(/(?:^|\n)(<{7}|={7}|>{7})[ \t]/)).toEqual([]);
    // Common UTF-8-read-as-Latin-1 signatures. Scanned RAW: a mojibake'd comment
    // is still mojibake.
    expect(scanRaw(/Ã¢|Ã©|â€™|â€œ|Â£|ï¿½/)).toEqual([]);
  });

  it("contains no secret-like literals", () => {
    // Scanned RAW: a key pasted into a comment is still a leaked key.
    expect(
      scanRaw(/(service_role|SUPABASE_SERVICE_ROLE|eyJhbGciOi|sk_live_|-----BEGIN [A-Z ]*PRIVATE KEY-----)/),
    ).toEqual([]);
  });
});

// ============================================================================
// Guard efficacy (B9DD-RR-006 §9.3)
//
// A static guard that cannot fail proves nothing. Each case below is a VERBATIM
// line from the pre-remediation source (or the exact shape Codex reported), and
// is asserted to be caught by the same pattern the guard runs against real
// files. If a pattern is ever weakened, these fail.
// ============================================================================

/**
 * Run a pattern through the EXACT pipeline `scan()` applies to production files:
 * comment-strip → whitespace-normalize → test. B9DD-FR-004 §10 requires the
 * efficacy cases to exercise the real scanner, not a parallel reimplementation,
 * so that weakening either half fails these tests.
 */
function matches(key: keyof typeof PATTERNS, source: string): boolean {
  return PATTERNS[key].test(normalizeSource(source));
}

describe("guard efficacy — the patterns catch the real pre-remediation source", () => {
  const CASES: Array<[keyof typeof PATTERNS, string, string]> = [
    ["myrInitializer", 'currency: "MYR",', "lib/invoice-schema.ts + lib/receipt-schema.ts defaults"],
    ["myrAssignment", 'const currency = "MYR";', "an assignment-style default"],
    ["myrParity", '{watchCurrency !== "MYR" && watchAmount > 0 && (', "receipt-summary-bar.tsx:44"],
    ["myrParity", 'if (watchCurrency === "MYR") return null;', "the === variant"],
    ["myrBaseLabel", "<p>Base Currency (MYR)</p>", "receipt-summary-bar.tsx:48"],
    ["myrBaseLabel", "<p>Base Total (MYR)</p>", "invoice-line-table.tsx:266"],
    ["myrFallback", 'const c = row.currency ?? "MYR";', "a runtime fallback"],
    ["myrDefaultParam", 'export function formatCurrency(amount: number, currency = "MYR") {', "the removed helper"],
    ["fakeAllHook", "export function useAllCustomers() {", "use-f2-data.ts:54"],
    ["falseZeroExposure", "outstandingMap.get(c.id)?.amount ?? 0,", "customers/page.tsx false zero"],
    ["fakeAllPageSize", "params: { page: 1, page_size: 500 },", "the pre-9D-D capped fetch"],
    ["forcedTotalPages", "const totalPages = 1;", "the forced single page"],
    ["firstRowCurrency", "allocations[0]?.receipt_currency", "allocation-history-table.tsx"],
    ["impossibleImportSource", 'if (raw === "csv_xlsx_import") return raw;', "import-governance.ts readSource"],
    ["mappedDataOrigin", "const s = mappedData.source;", "origin inferred from mapped_data"],
    ["crossCurrencyReduce", "const t = rows.reduce((s, r) => s + r.outstanding, 0);", "a cross-currency sum"],
    ["myrLiteral", 'const label = "MYR";', "any stray MYR literal"],
  ];

  it.each(CASES)("pattern %s catches %s (%s)", (key, line) => {
    expect(matches(key, line)).toBe(true);
  });

  it("does not flag legitimate non-monetary zero defaults", () => {
    // A tax RATE default of 0 (use-invoice-calculator.ts) is correct and must
    // not be caught by the false-zero exposure pattern.
    expect(
      matches("falseZeroExposure", "const taxRate = taxRateMap.get(line.tax_code_id) ?? 0;"),
    ).toBe(false);
  });

  it("does not flag the legitimate 'ocr' UI mode literal", () => {
    // The import pages switch between CSV and OCR modes; that literal is fine.
    expect(matches("impossibleImportSource", 'type ImportMode = "csv" | "ocr";')).toBe(false);
  });

  it("does not flag a compliant page size", () => {
    expect(matches("fakeAllPageSize", "params: { page, page_size: 100 },")).toBe(false);
    expect(matches("fakeAllPageSize", "params: { page, page_size: 25 },")).toBe(false);
  });
});

// ============================================================================
// Scanner robustness (B9DD-FR-004 §9)
//
// The guard used to test each LINE independently, so every pattern above was
// bypassable by pressing Enter. These cases pin the whole-file, comment-stripped
// behaviour that replaced it: each forbidden construct is caught however it is
// formatted, while a comment ABOUT one is not a hit.
// ============================================================================

describe("scanner robustness — formatting cannot bypass the guard", () => {
  it("catches a multiline MYR initializer", () => {
    // Exactly what the pre-remediation schema default would have looked like
    // after any formatter decided the line was too long.
    expect(matches("myrInitializer", 'currency:\n  "MYR",')).toBe(true);
    expect(matches("myrInitializer", 'currency\n  :\n    "MYR",')).toBe(true);
  });

  it("catches a multiline parity comparison", () => {
    expect(matches("myrParity", 'watchCurrency\n  !==\n  "MYR"')).toBe(true);
    expect(matches("myrParity", "if (\n  watchCurrency ===\n    'MYR'\n) return null;")).toBe(true);
  });

  it("catches a multiline runtime fallback", () => {
    expect(matches("myrFallback", 'const c =\n  row.currency ??\n  "MYR";')).toBe(true);
    expect(matches("myrFallback", 'const c = row.currency\n  || "MYR";')).toBe(true);
  });

  it("catches a multiline cross-currency reduce", () => {
    expect(
      matches(
        "crossCurrencyReduce",
        "const t = rows.reduce(\n  (sum, row) =>\n    sum + row.outstanding,\n  0,\n);",
      ),
    ).toBe(true);
  });

  it("catches a multiline base label", () => {
    expect(matches("myrBaseLabel", "<p>\n  Base Total\n  (MYR)\n</p>")).toBe(true);
  });

  it("catches a multiline false-zero exposure read", () => {
    expect(
      matches("falseZeroExposure", "outstandingMap\n  .get(c.id)\n  ?.amount\n  ?? 0,"),
    ).toBe(true);
  });

  it("catches a construct split by an inline block comment", () => {
    // A block comment between tokens must not glue them into something
    // unrecognisable, nor break the match: it collapses to whitespace.
    expect(matches("myrInitializer", 'currency: /* the default */ "MYR",')).toBe(true);
    expect(matches("myrParity", 'watchCurrency /* base? */ !== /* literal */ "MYR"')).toBe(true);
    expect(matches("myrFallback", 'row.currency ?? /* fallback */ "MYR"')).toBe(true);
  });

  it("does not flag a line comment that merely documents a forbidden pattern", () => {
    expect(matches("myrInitializer", '// never write currency: "MYR" in a schema default')).toBe(false);
    expect(matches("myrFallback", '// a runtime `?? "MYR"` mislabels foreign amounts')).toBe(false);
    expect(matches("myrParity", "// do not branch on watchCurrency !== 'MYR'")).toBe(false);
  });

  it("does not flag a block comment that documents a forbidden pattern", () => {
    const doc = [
      "/**",
      " * Historical note: this module used to do",
      ' *   currency: "MYR",',
      ' * and compared watchCurrency !== "MYR" to decide parity.',
      " */",
      "export const x = 1;",
    ].join("\n");
    expect(matches("myrInitializer", doc)).toBe(false);
    expect(matches("myrParity", doc)).toBe(false);
    expect(matches("myrLiteral", doc)).toBe(false);
  });

  it("still flags real code that sits after a documentation comment", () => {
    // The comment must not act as a shield for the code following it.
    const src = ['/* currency: "MYR" is forbidden */', 'const c = { currency: "MYR" };'].join("\n");
    expect(matches("myrInitializer", src)).toBe(true);
  });

  it("treats string contents as real runtime values, not comments", () => {
    // `//` inside a URL must not start a comment and swallow the rest of the file.
    const src = ['const url = "https://example.com/x";', 'const c = { currency: "MYR" };'].join("\n");
    expect(matches("myrInitializer", src)).toBe(true);
    // A `/*` inside a string literal likewise must not open a comment.
    const src2 = ['const glob = "/**/*.ts";', 'const c = { currency: "MYR" };'].join("\n");
    expect(matches("myrInitializer", src2)).toBe(true);
  });

  it("keeps an apostrophe in a comment from swallowing later code", () => {
    // A prose apostrophe is not an unterminated string once comments are gone.
    const src = ["// the customer's exposure is authoritative", 'const c = { currency: "MYR" };'].join("\n");
    expect(matches("myrInitializer", src)).toBe(true);
  });

  it("preserves template literal contents", () => {
    expect(stripComments("const t = `a ${x} b`;")).toBe("const t = `a ${x} b`;");
    // A multi-line template literal must survive intact.
    expect(stripComments("const t = `line1\nline2`;")).toContain("line1\nline2");
  });

  it("blanks comments to whitespace rather than deleting them", () => {
    // Deleting would fuse `a` and `b` into the identifier `ab`.
    expect(normalizeSource("const a =/* x */b;")).toBe("const a = b;");
    expect(stripComments("a/* x */b")).toBe("a       b");
  });

  it("leaves every non-comment byte at its original offset", () => {
    // Blanking (not deleting) is what keeps `rows.reduce((` intact, so patterns
    // that rely on real adjacency still match.
    const src = 'const t = rows.reduce((s, r) => s + r.outstanding, 0); // note';
    const stripped = stripComments(src);
    expect(stripped.length).toBe(src.length);
    expect(stripped).toContain("rows.reduce((s, r) => s + r.outstanding, 0);");
  });

  it("does not flag the mojibake-detection regex as actual file corruption", () => {
    // This suite's own detector contains the very byte sequences it looks for.
    // It is a TEST file, so it is excluded from SOURCE_FILES — assert that the
    // exclusion really holds rather than trusting it.
    const self = path.join(SRC, "lib", "monetary-guard.test.ts");
    expect(SOURCE_FILES).not.toContain(self);
    expect(SOURCE_FILES.some((f) => /\.test\.tsx?$/.test(f))).toBe(false);
  });

  it("rejects a stateful /g pattern rather than silently skipping files", () => {
    // A /g regex reused across files leaks `lastIndex` and misses real hits.
    expect(() => scan(/MYR/g)).toThrow(/lastIndex/);
  });

  it("scans the production files it claims to, and no build output", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(50);
    expect(SOURCE_FILES.some((f) => f.includes("node_modules"))).toBe(false);
    expect(SOURCE_FILES.some((f) => f.includes(`${path.sep}.next${path.sep}`))).toBe(false);
    // Windows and POSIX separators both resolve through path.join/path.sep.
    expect(SOURCE_FILES.every((f) => path.isAbsolute(f))).toBe(true);
  });
});

// ============================================================================
// Regex-literal safety (B9DD-DR-002)
//
// A regex literal may legally contain raw comment delimiters. The previous
// hand-rolled stripper did not model regex literals, so `/[/*]/` looked like an
// unterminated block comment and it deleted THE REST OF THE FILE — every later
// violation left the scan silently. That is a FALSE NEGATIVE, not over-scanning.
//
// The parser now resolves `/` (divide) vs `/` (regex start) with real grammatical
// context, which a lexer alone cannot do. Every case below runs through the SAME
// `normalizeSource` the production scan uses.
// ============================================================================

describe("regex-literal safety — a regex cannot hide later code (B9DD-DR-002)", () => {
  it("catches a MYR initializer after a regex containing raw //", () => {
    expect(matches("myrInitializer", 'const r = /[//]/;\nconst value = { currency: "MYR" };')).toBe(true);
  });

  it("catches a MYR initializer after a regex containing raw /*", () => {
    // The exact case that erased the rest of the file.
    expect(matches("myrInitializer", 'const r = /[/*]/;\nconst value = { currency: "MYR" };')).toBe(true);
  });

  it("catches a MYR fallback after a regex containing raw /*", () => {
    expect(matches("myrFallback", 'const r = /[/*]/;\nconst value = row.currency ?? "MYR";')).toBe(true);
  });

  it("catches a MYR fallback after an escaped-slash regex", () => {
    expect(matches("myrFallback", 'const r = /\\/\\//;\nconst value = row.currency ?? "MYR";')).toBe(true);
  });

  it("catches a parity comparison after a regex matching a block-comment opener", () => {
    expect(matches("myrParity", 'const r = /\\/\\*/;\nconst v = watchCurrency !== "MYR";')).toBe(true);
  });

  it("catches a parity comparison after a URL regex", () => {
    expect(matches("myrParity", 'const r = /https?:\\/\\/example/;\nconst v = watchCurrency !== "MYR";')).toBe(true);
  });

  it("catches a multiline reduce after a regex matching //", () => {
    expect(
      matches(
        "crossCurrencyReduce",
        "const r = /\\/\\//;\nconst total = rows.reduce(\n  (sum, row) => sum + row.outstanding,\n  0,\n);",
      ),
    ).toBe(true);
  });

  it("catches forbidden code on the SAME line as a regex literal", () => {
    expect(matches("myrInitializer", 'const r = /[//]/; const value = { currency: "MYR" };')).toBe(true);
    expect(matches("myrInitializer", 'const r = /[/*]/; const value = { currency: "MYR" };')).toBe(true);
  });

  it("catches forbidden code far later in a file that opens with a regex", () => {
    const src = [
      "const slash = /[/*]/;",
      "const other = /[//]/;",
      "function a() { return 1; }",
      "function b() { return 2; }",
      'const value = { currency: "MYR" };',
    ].join("\n");
    expect(matches("myrInitializer", src)).toBe(true);
  });

  it("handles regexes with escaped slashes and character classes", () => {
    const src = 'const r = /^\\/api\\/[a-z/]+\\/?$/i;\nconst v = row.currency ?? "MYR";';
    expect(matches("myrFallback", src)).toBe(true);
  });

  it("catches a hard-coded base label in TSX that also contains a regex", () => {
    const src = [
      "const path = /[/*]/;",
      "export function C() {",
      "  return <p>Base Total (MYR)</p>;",
      "}",
    ].join("\n");
    expect(PATTERNS.myrBaseLabel.test(normalizeSource(src, "c.tsx"))).toBe(true);
  });

  it("still ignores REAL comments that merely mention a forbidden pattern", () => {
    expect(matches("myrInitializer", 'const r = /[/*]/;\n// never write currency: "MYR" here')).toBe(false);
    expect(matches("myrParity", '/* historical: watchCurrency !== "MYR" */\nconst r = /[//]/;')).toBe(false);
  });

  it("still detects forbidden code that FOLLOWS a real comment", () => {
    const src = ['/* currency: "MYR" is forbidden */', 'const r = /[//]/;', 'const c = { currency: "MYR" };'].join("\n");
    expect(matches("myrInitializer", src)).toBe(true);
  });

  it("preserves URL and glob strings containing comment delimiters", () => {
    expect(matches("myrInitializer", 'const u = "https://x.example/a";\nconst c = { currency: "MYR" };')).toBe(true);
    expect(matches("myrInitializer", 'const g = "/**/*.ts";\nconst c = { currency: "MYR" };')).toBe(true);
  });

  it("keeps a compliant regex-bearing file clean", () => {
    // The counterpart that matters: parser-backed scanning must not invent hits.
    const src = [
      "const slash = /[//]/;",
      "const star = /[/*]/;",
      "const url = /https?:\\/\\//;",
      "export const supported = getSupportedCurrencies();",
      "export const label = formatMoney(amount, currency);",
    ].join("\n");
    for (const key of Object.keys(PATTERNS) as Array<keyof typeof PATTERNS>) {
      expect(matches(key, src), `${key} must not match compliant regex-bearing code`).toBe(false);
    }
  });

  it("parses .ts and .tsx with the correct script kind", () => {
    // A TSX generic arrow is only valid in .tsx; a .ts type assertion `<T>x` is
    // only valid in .ts. Parsing with the wrong variant yields wrong tokens.
    expect(parseSource("const C = () => <p>hi</p>;", "c.tsx").languageVariant).toBe(
      ts.LanguageVariant.JSX,
    );
    expect(parseSource("const x = 1;", "x.ts").languageVariant).toBe(ts.LanguageVariant.Standard);
    // JSX text containing `//` is CONTENT and must not be treated as a comment.
    const jsx = 'export function C() {\n  return <p>see https://x.example</p>;\n}';
    expect(normalizeSource(jsx, "c.tsx")).toContain("https://x.example");
  });

  it("ignores a JSX expression comment but keeps the JSX around it", () => {
    const src = 'export function C() {\n  return <p>{/* currency: "MYR" */}Base Total ({base})</p>;\n}';
    const normalized = normalizeSource(src, "c.tsx");
    expect(normalized).not.toContain("MYR");
    expect(normalized).toContain("Base Total");
  });
});

// ============================================================================
// AST literal/template inspection (B9DD-MDR-003 §7.1)
//
// The previous visitor collected StringLiteral + NoSubstitutionTemplateLiteral
// only, so every INTERPOLATED template escaped it: `MYR${x}`, `${p}MYR${s}` and
// `${p}MYR` all passed. Their static text lives in TemplateHead / TemplateMiddle
// / TemplateTail, which were never visited.
//
// These call the same `staticStringText` visitor the production scan uses.
// ============================================================================

/** Run the production literal visitor over a snippet. */
function staticTextOf(src: string, fileName = "e.tsx"): string[] {
  return staticStringText(parseSource(src, fileName));
}
const findsMyr = (src: string, fileName = "e.tsx") =>
  staticTextOf(src, fileName).some((t) => t.includes("MYR"));

describe("AST literal/template inspection (B9DD-MDR-003 §7.1)", () => {
  it("detects a bare string literal", () => {
    expect(findsMyr('const a = "MYR";')).toBe(true);
    expect(findsMyr("const a = 'MYR';")).toBe(true);
  });

  it("detects a non-substitution template", () => {
    expect(findsMyr("const a = `MYR`;")).toBe(true);
  });

  it("detects MYR in a template HEAD", () => {
    expect(findsMyr("const a = `MYR${suffix}`;")).toBe(true);
  });

  it("detects MYR in a template MIDDLE", () => {
    expect(findsMyr("const a = `${prefix}MYR${suffix}`;")).toBe(true);
  });

  it("detects MYR in a template TAIL", () => {
    expect(findsMyr("const a = `${prefix}MYR`;")).toBe(true);
  });

  it("detects MYR in a multi-span template", () => {
    expect(findsMyr("const a = `${a} X ${b} MYR ${c}`;")).toBe(true);
  });

  it("detects a template after a regex containing raw comment delimiters", () => {
    expect(findsMyr("const r = /[/*]/;\nconst a = `${p}MYR${s}`;")).toBe(true);
    expect(findsMyr("const r = /[//]/;\nconst a = `MYR${s}`;")).toBe(true);
  });

  it("ignores MYR in a real comment", () => {
    expect(findsMyr('// historical: `MYR${x}` was used here')).toBe(false);
    expect(findsMyr("/* const a = `${p}MYR`; */\nconst b = 1;")).toBe(false);
  });

  it("does NOT treat a regex body as a runtime string literal", () => {
    // A regex is a RegularExpressionLiteral, not a string — structurally
    // distinct, so no pattern exclusion is needed.
    expect(findsMyr("const r = /MYR/;")).toBe(false);
    expect(findsMyr("const r = /^(MYR|SGD)$/;")).toBe(false);
  });

  it("still detects a real literal that follows a regex mentioning MYR", () => {
    expect(findsMyr('const r = /MYR/;\nconst a = { currency: "MYR" };')).toBe(true);
  });

  it("inspects JSX attribute and expression literals", () => {
    expect(findsMyr('export const C = () => <p title="MYR">x</p>;', "c.tsx")).toBe(true);
    expect(findsMyr("export const C = () => <p>{`${p}MYR`}</p>;", "c.tsx")).toBe(true);
  });

  // ── B9DD-CDR-003 §5: JSX static text ──────────────────────────────────────
  // All three were MISSED before this gate: JsxText is its own node kind, so a
  // visitor that only tested string/template nodes never saw rendered content.

  it("detects MYR in JSX element text", () => {
    expect(findsMyr("export const C = () => <span>MYR</span>;", "c.tsx")).toBe(true);
  });

  it("detects MYR in JSX text alongside other words", () => {
    expect(findsMyr("export const C = () => <p>Amount: MYR</p>;", "c.tsx")).toBe(true);
  });

  it("detects MYR in multi-line JSX text", () => {
    // Whitespace is normalized for inspection, so the source's newlines and
    // indentation cannot hide the token.
    expect(findsMyr("export const C = () => (\n  <p>\n    Total amount in\n    MYR\n  </p>\n);", "c.tsx")).toBe(true);
    expect(staticTextOf("export const C = () => <p>\n  Amount in\n  MYR\n</p>;", "c.tsx")).toEqual([
      "Amount in MYR",
    ]);
  });

  it("does not join separate JSX nodes into a fabricated MYR token", () => {
    // `<>MY{x}R</>` renders "MY", then a value, then "R". Joining the JsxText
    // siblings would invent an "MYR" literal that no user ever sees — a false
    // positive, and worse, one that would push authors to distrust the guard.
    expect(findsMyr("export const C = () => <p>MY{x}R</p>;", "c.tsx")).toBe(false);
    expect(staticTextOf("export const C = () => <p>MY{x}R</p>;", "c.tsx")).toEqual(["MY", "R"]);
    // Sibling ELEMENTS must not be joined either.
    expect(findsMyr("export const C = () => <p><b>MY</b><b>R</b></p>;", "c.tsx")).toBe(false);
  });

  it("ignores MYR inside a JSX expression comment", () => {
    expect(findsMyr("export const C = () => <p>{/* MYR */}x</p>;", "c.tsx")).toBe(false);
  });

  it("keeps JSX text that merely looks like a comment intact", () => {
    // JSX text is CONTENT: `//` in it is not a comment delimiter.
    expect(findsMyr("export const C = () => <p>// MYR</p>;", "c.tsx")).toBe(true);
  });

  it("keeps template spans separate so interpolation cannot forge a match", () => {
    // `${a}MY` + `R${b}` must NOT be joined into "MYR".
    expect(findsMyr("const a = `${x}MY` + `R${y}`;")).toBe(false);
    expect(staticTextOf("const a = `MY${x}R`;")).toEqual(["MY", "R"]);
  });
});

// ============================================================================
// AST structural monetary-reduction inspection (B9DD-MDR-003 §7.2)
//
// The old regex matched `row.outstanding` only. Each of the spellings below is
// the SAME prohibited operation and each one escaped it. Adding one more regex
// per spelling was the wrong fix; the AST unwraps to the access itself.
//
// These call the same `monetaryReduceCallbacks` visitor the production scan uses.
// ============================================================================

const reduceIsFlagged = (src: string, fileName = "e.tsx") =>
  monetaryReduceCallbacks(parseSource(src, fileName)).length > 0;

describe("AST monetary-reduction inspection (B9DD-MDR-003 §7.2)", () => {
  const PROHIBITED: Array<[string, string]> = [
    ["direct property access", "const t = rows.reduce((s, row) => s + row.outstanding, 0);"],
    ["optional property access", "const t = rows.reduce((s, row) => s + row?.outstanding, 0);"],
    ["string element access", 'const t = rows.reduce((s, row) => s + row["outstanding"], 0);'],
    ["optional element access", 'const t = rows.reduce((s, row) => s + row?.["outstanding"], 0);'],
    ["parenthesized access", "const t = rows.reduce((s, row) => s + (row.outstanding), 0);"],
    ["type assertion", "const t = rows.reduce((s, row) => s + (row as Row).outstanding, 0);"],
    ["non-null assertion", "const t = rows.reduce((s, row) => s + row!.outstanding, 0);"],
    ["Number() wrapper", "const t = rows.reduce((s, row) => s + Number(row.outstanding), 0);"],
    ["Number() + optional chain", "const t = rows.reduce((s, row) => s + Number(row?.outstanding), 0);"],
    ["parseFloat wrapper", "const t = rows.reduce((s, row) => s + parseFloat(row.outstanding), 0);"],
    ["unary plus", "const t = rows.reduce((s, row) => s + +row.outstanding, 0);"],
    [
      "multiline optional chain",
      "const t = rows.reduce(\n  (sum, row) =>\n    sum +\n    row?.outstanding,\n  0,\n);",
    ],
    [
      "block body with return",
      "const t = rows.reduce((s, row) => {\n  return s + row?.outstanding;\n}, 0);",
    ],
    [
      "block body with +=",
      "const t = rows.reduce((s, row) => {\n  let acc = s;\n  acc += row['outstanding'];\n  return acc;\n}, 0);",
    ],
    ["function expression callback", "const t = rows.reduce(function (s, row) { return s + row.outstanding; }, 0);"],
    ["optional reduce call", "const t = rows?.reduce((s, row) => s + row?.outstanding, 0);"],

    // ── B9DD-CDR-003 §4.6: every one of these was MISSED before this gate ────
    // Reproduced against the previous visitor first: 11 of 11 returned false.

    // §4.2 fallbacks — the value is still read, the `?? 0` only hides it.
    ["nullish fallback", "const t = rows.reduce((s, row) => s + (row?.outstanding ?? 0), 0);"],
    ["logical fallback", "const t = rows.reduce((s, row) => s + (row?.outstanding || 0), 0);"],
    ["nested Number + fallback", "const t = rows.reduce((s, row) => s + Number(row?.outstanding ?? 0), 0);"],
    ["conditional expression", "const t = rows.reduce((s, row) => s + (row.ok ? row.outstanding : 0), 0);"],

    // §4.1 destructuring — no property access exists to match at all.
    ["destructured field", "const t = rows.reduce((s, { outstanding }) => s + outstanding, 0);"],
    ["aliased destructured field", "const t = rows.reduce((s, { outstanding: value }) => s + value, 0);"],
    [
      "typed destructuring",
      "const t = rows.reduce((s: number, { outstanding }: Row) => s + outstanding, 0);",
    ],
    [
      "destructuring formatted across lines",
      "const t = rows.reduce(\n  (\n    sum,\n    { outstanding: value },\n  ) => sum + value,\n  0,\n);",
    ],

    // §4.3 callback-local taint — the read and the sum are different statements.
    [
      "intermediate const",
      "const t = rows.reduce((s, row) => {\n  const value = row.outstanding;\n  return s + value;\n}, 0);",
    ],
    [
      "intermediate let + assignment",
      "const t = rows.reduce((s, row) => {\n  let value;\n  value = row?.outstanding ?? 0;\n  return s + value;\n}, 0);",
    ],
    [
      "destructuring statement inside body",
      "const t = rows.reduce((s, row) => {\n  const { outstanding } = row;\n  return s + outstanding;\n}, 0);",
    ],
    [
      "aliased destructuring statement inside body",
      "const t = rows.reduce((s, row) => {\n  const { outstanding: value } = row;\n  return s + value;\n}, 0);",
    ],

    // §4.4 accumulator updates.
    [
      "sum = sum + protected",
      "const t = rows.reduce((s, row) => {\n  let acc = s;\n  acc = acc + row.outstanding;\n  return acc;\n}, 0);",
    ],
    [
      "intermediate next accumulator",
      "const t = rows.reduce((s, row) => {\n  const next = s + row.outstanding;\n  return next;\n}, 0);",
    ],
    [
      "multiple statements before aggregation",
      "const t = rows.reduce((s, row) => {\n  const id = row.id;\n  const value = row['outstanding'];\n  if (!id) return s;\n  return s + value;\n}, 0);",
    ],

    // ── B9DD-CRR-003 §3.3: RETURNED accumulator assignments ─────────────────
    // `return (sum += x)` is an assignment EXPRESSION whose value is the new
    // accumulator. The previous visitor checked `return <expr>` only via
    // `addsProtected`, which requires a top-level `+` — an assignment is not a
    // `+`, so every one of these escaped despite being squarely inside the
    // documented callback-local accumulator-update scope.
    ["returned +=", "const t = rows.reduce((sum, row) => { return (sum += row.outstanding); }, 0);"],
    [
      "returned = acc + protected",
      "const t = rows.reduce((sum, row) => { return (sum = sum + row.outstanding); }, 0);",
    ],
    [
      "returned += inside an assertion",
      "const t = rows.reduce((sum, row) => { return ((sum += row?.outstanding ?? 0) as number); }, 0);",
    ],
    [
      "returned Number(+=)",
      "const t = rows.reduce((sum, row) => { return Number(sum += row.outstanding); }, 0);",
    ],
    [
      "returned protected + acc (operand order)",
      "const t = rows.reduce((sum, row) => { return (sum = row.outstanding + sum); }, 0);",
    ],
    // Accumulator ALIASES.
    [
      "alias const, returned +=",
      "const t = rows.reduce((sum, row) => { const acc = sum; return (acc += row.outstanding); }, 0);",
    ],
    [
      "alias let, returned = acc + protected",
      "const t = rows.reduce((sum, row) => { let acc = sum; return (acc = acc + row.outstanding); }, 0);",
    ],
    // Placement: branch / nested block / after an early return.
    [
      "returned += inside an if branch",
      "const t = rows.reduce((sum, row) => { if (row.ok) { return (sum += row.outstanding); } return sum; }, 0);",
    ],
    [
      "returned += inside a nested block",
      "const t = rows.reduce((sum, row) => { { return (sum += row.outstanding); } }, 0);",
    ],
    [
      "returned += after an early return",
      "const t = rows.reduce((sum, row) => { if (!row) return sum; return (sum += row.outstanding); }, 0);",
    ],
    [
      "returned += in a function-expression reducer",
      "const t = rows.reduce(function (sum, row) { return (sum += row.outstanding); }, 0);",
    ],
    [
      "returned += via reduceRight",
      "const t = rows.reduceRight((sum, row) => { return (sum += row.outstanding); }, 0);",
    ],

    // §4.4 reduceRight — same operation, same money, different name.
    ["reduceRight", "const t = rows.reduceRight((s, row) => s + row.outstanding, 0);"],
    ["reduceRight with fallback", "const t = rows.reduceRight((s, row) => s + (row?.outstanding ?? 0), 0);"],
    [
      "reduceRight block body with +=",
      "const t = rows.reduceRight((s, row) => {\n  let acc = s;\n  acc += row.outstanding;\n  return acc;\n}, 0);",
    ],
  ];

  it.each(PROHIBITED)("flags a monetary reduce using %s", (_name, src) => {
    expect(reduceIsFlagged(src)).toBe(true);
  });

  const OTHER_FIELDS: Array<[string, string]> = [
    ["total_amount", "const t = rows.reduce((s, r) => s + r?.total_amount, 0);"],
    ["receipt_amount", "const t = rows.reduce((s, r) => s + r?.receipt_amount, 0);"],
    ["allocated_amount", "const t = rows.reduce((s, r) => s + r?.allocated_amount, 0);"],
    ["base_total", "const t = rows.reduce((s, r) => s + r?.base_total, 0);"],
    ["amount", "const t = rows.reduce((s, r) => s + r?.amount, 0);"],
  ];

  it.each(OTHER_FIELDS)("covers the governed monetary field %s", (_name, src) => {
    expect(reduceIsFlagged(src)).toBe(true);
  });

  it("flags a monetary reduce after a regex containing raw comment delimiters", () => {
    expect(reduceIsFlagged("const r = /[/*]/;\nconst t = rows.reduce((s, row) => s + row?.outstanding, 0);")).toBe(true);
    expect(reduceIsFlagged("const r = /[//]/;\nconst t = rows.reduce((s, row) => s + row.outstanding, 0);")).toBe(true);
  });

  it("flags a monetary reduce that follows a real comment", () => {
    const src = [
      "// summing outstanding client-side is forbidden",
      "const t = rows.reduce((s, row) => s + row?.outstanding, 0);",
    ].join("\n");
    expect(reduceIsFlagged(src)).toBe(true);
  });

  // ── Must NOT produce false positives ──────────────────────────────────────

  it("ignores a comment that merely documents a forbidden reduce", () => {
    expect(reduceIsFlagged("// const t = rows.reduce((s, row) => s + row.outstanding, 0);")).toBe(false);
    expect(reduceIsFlagged("/*\n  rows.reduce((s, r) => s + r.outstanding, 0)\n*/\nconst x = 1;")).toBe(false);
  });

  it("ignores a regex literal that looks like a reduce", () => {
    expect(reduceIsFlagged("const r = /reduce\\(\\(s, r\\) => s \\+ r\\.outstanding/;")).toBe(false);
  });

  it("ignores string concatenation", () => {
    expect(reduceIsFlagged("const t = rows.reduce((s, row) => s + row.invoice_no, '');")).toBe(false);
    expect(reduceIsFlagged("const t = rows.reduce((s, row) => s + row.customer_name, '');")).toBe(false);
  });

  it("ignores non-monetary numeric reduces", () => {
    expect(reduceIsFlagged("const t = rows.reduce((s, row) => s + row.count, 0);")).toBe(false);
    expect(reduceIsFlagged("const t = rows.reduce((s, row) => s + row.quantity, 0);")).toBe(false);
    // A tax RATE default is legitimate and unrelated.
    expect(reduceIsFlagged("const t = lines.reduce((s, l) => s + l.tax_rate, 0);")).toBe(false);
  });

  it("ignores a non-additive reduce", () => {
    expect(reduceIsFlagged("const m = rows.reduce((acc, row) => ({ ...acc, [row.id]: row.outstanding }), {});")).toBe(false);
    expect(reduceIsFlagged("const t = rows.reduce((s, row) => Math.max(s, row.outstanding), 0);")).toBe(false);
  });

  it("ignores a compliant currency-grouped reduction", () => {
    // Grouping BY currency and summing within each group is the sanctioned
    // shape; it never mixes currencies. It still reads a monetary field, so
    // this documents that such utilities live behind the reviewed allow-list
    // rather than being silently pattern-excluded.
    const grouped = "const g = rows.reduce((acc, row) => { acc[row.currency] = (acc[row.currency] ?? 0); return acc; }, {});";
    expect(reduceIsFlagged(grouped)).toBe(false);
  });

  it("ignores a protected read in a nested function that is not the accumulator", () => {
    // §4.5: the reducer sums a NON-monetary field. `row.outstanding` appears
    // only inside an unrelated nested callback, so attributing it to the outer
    // reducer would be a false positive born of walking too eagerly.
    const src = [
      "const t = rows.reduce((s, row) => {",
      "  const flagged = row.children.filter((c) => c.outstanding > 0);",
      "  return s + flagged.length;",
      "}, 0);",
    ].join("\n");
    expect(reduceIsFlagged(src)).toBe(false);
  });

  it("ignores returned assignments that are not protected accumulator mutation", () => {
    // B9DD-CRR-003 §3.4. The returned-assignment rule must not become "any
    // returned assignment is suspicious" — that would flag ordinary code and
    // train authors to ignore the guard.

    // The left-hand side is a PROPERTY write, not the accumulator.
    expect(reduceIsFlagged("const t = rows.reduce((sum, row) => { return (row.count += 1); }, 0);")).toBe(false);
    // A protected field on the LEFT is still not accumulator mutation.
    expect(
      reduceIsFlagged("const t = rows.reduce((sum, row) => { return (row.outstanding += 1); }, 0);"),
    ).toBe(false);
    // The accumulator IS mutated, but with a non-protected field.
    expect(reduceIsFlagged("const t = rows.reduce((sum, row) => { return (sum += row.quantity); }, 0);")).toBe(false);
    expect(reduceIsFlagged("const t = rows.reduce((sum, row) => { return (sum = sum + row.count); }, 0);")).toBe(false);
    // A local that is not the accumulator, mutated with a protected value, whose
    // result is never folded into the accumulator.
    expect(
      reduceIsFlagged(
        "const t = rows.reduce((sum, row) => { let seen = 0; seen += row.outstanding; return sum + row.count; }, 0);",
      ),
    ).toBe(false);
    // The currency-grouped shape stays clean: the left side is an element write.
    expect(
      reduceIsFlagged(
        "const g = rows.reduce((acc, row) => { acc[row.currency] = (acc[row.currency] ?? 0); return acc; }, {});",
      ),
    ).toBe(false);
  });

  it("ignores a reduce over a non-monetary destructured field", () => {
    expect(reduceIsFlagged("const t = rows.reduce((s, { count }) => s + count, 0);")).toBe(false);
    expect(reduceIsFlagged("const t = rows.reduce((s, { quantity: q }) => s + q, 0);")).toBe(false);
  });

  it("ignores an object-mapping reduceRight that combines nothing arithmetically", () => {
    expect(
      reduceIsFlagged("const m = rows.reduceRight((acc, row) => ({ ...acc, [row.id]: row.outstanding }), {});"),
    ).toBe(false);
  });

  it("documents the bounded-analysis boundary honestly", () => {
    // §4.3: analysis stops at the callback. A value laundered through an
    // EXTERNAL helper is NOT detected, and pretending otherwise would be the
    // dishonest thing to do here. Whole-program dataflow is out of scope, so
    // this guard is a strong barrier against the realistic accidental case, not
    // a proof of absence against a determined author.
    //
    // This asserts the CURRENT limit so it is visible in review and fails loudly
    // if anyone later claims coverage this analysis does not have.
    const launderedThroughHelper = "const t = rows.reduce((s, row) => s + toNumber(row), 0);";
    expect(reduceIsFlagged(launderedThroughHelper)).toBe(false);

    // The complementary fact: once the read is visible in the callback, the
    // wrapper does not matter.
    expect(reduceIsFlagged("const t = rows.reduce((s, row) => s + Number(row.outstanding), 0);")).toBe(true);
  });

  it("keeps compliant regex-bearing source clean across every check", () => {
    const src = [
      "const slash = /[//]/;",
      "const star = /[/*]/;",
      "const url = /https?:\\/\\//;",
      "export const total = getBackendSummary().base_total;",
      "export const label = formatMoney(amount, currency);",
    ].join("\n");
    expect(reduceIsFlagged(src)).toBe(false);
    expect(findsMyr(src)).toBe(false);
    for (const key of Object.keys(PATTERNS) as Array<keyof typeof PATTERNS>) {
      expect(matches(key, src), `${key} must not match compliant source`).toBe(false);
    }
  });

  it("would fail if the AST logic were bypassed", () => {
    // The efficacy cases above run through the SAME visitor the production scan
    // uses. If `monetaryReduceCallbacks` stopped unwrapping, or the field set
    // were emptied, these become false and this suite fails — which is the
    // point of asserting it explicitly rather than trusting the wiring.
    expect(MONETARY_FIELDS.has("outstanding")).toBe(true);
    expect(MONETARY_FIELDS.size).toBeGreaterThanOrEqual(6);
    expect(reduceIsFlagged("const t = rows.reduce((s, row) => s + row?.outstanding, 0);")).toBe(true);
  });
});

describe("Monetary reduce — no weakening from the CRR-003 accumulator rule", () => {
  // B9DD-CRR-003 introduced the rule that an accumulator MUTATION only counts
  // when the left-hand side is the accumulator (so `row.count += 1` stays
  // clean). That rule, taken alone, would have SILENTLY WEAKENED the guard:
  // a protected value could be laundered through an ordinary local that is not
  // the accumulator, then folded in afterwards. Caught while writing the
  // false-positive controls, and pinned here so it cannot regress.
  it("still flags a protected value laundered through a non-accumulator local", () => {
    expect(
      reduceIsFlagged("const t = rows.reduce((sum, row) => { let x = 0; x += row.outstanding; return sum + x; }, 0);"),
    ).toBe(true);
    expect(
      reduceIsFlagged("const t = rows.reduce((sum, row) => { let x = 0; x = row?.outstanding ?? 0; return sum + x; }, 0);"),
    ).toBe(true);
  });

  it("does not flag a laundered value that never reaches the accumulator", () => {
    // The complementary control: tainting a local is not itself aggregation.
    expect(
      reduceIsFlagged(
        "const t = rows.reduce((sum, row) => { let seen = 0; seen += row.outstanding; return sum + row.count; }, 0);",
      ),
    ).toBe(false);
  });
});
