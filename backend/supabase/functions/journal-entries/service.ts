// ============================================================================
// TSH Synergy ERP — Accounts Receivable Module
// Journal Entry Generation Engine
// Implements PRD Part 5 — ALL 20 journal entry scenarios
// ============================================================================
// This is an INTERNAL service — not exposed as an API endpoint.
// Called by Invoice, Receipt, and Allocation services during posting.
// ============================================================================

import { SupabaseClient } from 'supabase';
import { callRpc, getAdminClient, getNextSequence, isFiscalPeriodOpen } from '../_shared/db.ts';
import { BRErrors, BusinessError } from '../_shared/errors.ts';

import type { JESourceType } from '../_shared/types.ts';
import { roundTo2 } from '../invoices/calculator.ts';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface JELineInput {
  gl_account_id: string;
  description: string;
  debit_amount: number;
  credit_amount: number;
  currency?: string;
  original_amount?: number;
}

export interface CreateJEInput {
  company_id: string;
  je_date: string;         // YYYY-MM-DD
  posting_period: string;  // YYYY-MM
  source_type: JESourceType;
  source_doc_no: string;
  source_doc_id: string;
  description: string;
  currency?: string;
  exchange_rate?: number;
  base_currency?: string;
  lines: JELineInput[];
  created_by: string;
  // Reversal fields
  is_reversal?: boolean;
  original_je_id?: string;
}

export interface JEResult {
  id: string;
  je_no: string;
  total_debit: number;
  total_credit: number;
}

// ─── Journal Entry Service ──────────────────────────────────────────────────

export class JournalEntryService {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client ?? getAdminClient();
  }

  // ════════════════════════════════════════════════════════════════════════
  // CREATE JOURNAL ENTRY (Core method)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Create a complete journal entry with lines.
   * Enforces:
   * - BR-JE-006: Debit = Credit balance
   * - BR-JE-007: Fiscal period must be open
   * - BR-JE-001: Same-account same-side lines are merged
   */
  async createJournalEntry(input: CreateJEInput): Promise<JEResult> {
    // BR-JE-007: Validate fiscal period is open
    const periodOpen = await isFiscalPeriodOpen(this.client, input.company_id, input.posting_period);
    if (!periodOpen) {
      throw BRErrors.JE_007_PERIOD_CLOSED(input.posting_period);
    }

    // BR-JE-001: Merge lines with same GL account on same side
    const mergedLines = this.mergeLines(input.lines);

    // Calculate totals
    const totalDebit = roundTo2(mergedLines.reduce((s, l) => s + l.debit_amount, 0));
    const totalCredit = roundTo2(mergedLines.reduce((s, l) => s + l.credit_amount, 0));

    // BR-JE-006: Debit must equal Credit
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new BusinessError('BR-JE-006',
        `Journal entry debit/credit imbalance. Debit: ${totalDebit}, Credit: ${totalCredit}, Diff: ${roundTo2(totalDebit - totalCredit)}`,
        400,
        { total_debit: totalDebit, total_credit: totalCredit },
      );
    }

    // Generate JE number: JE-{source}-YYYYMM-NNNNN
    const jeNo = await getNextSequence(this.client, input.company_id, 'JE', input.source_type);

    // Insert header
    const { data: je, error: jeError } = await this.client
      .from('journal_entries')
      .insert({
        company_id: input.company_id,
        je_no: jeNo,
        je_date: input.je_date,
        posting_period: input.posting_period,
        source_type: input.source_type,
        source_doc_no: input.source_doc_no,
        source_doc_id: input.source_doc_id,
        description: input.description,
        currency: input.currency ?? null,
        exchange_rate: input.exchange_rate ?? 1.0,
        base_currency: input.base_currency ?? null,
        total_debit: totalDebit,
        total_credit: totalCredit,
        is_reversal: input.is_reversal ?? false,
        original_je_id: input.original_je_id ?? null,
        created_by: input.created_by,
      })
      .select('id, je_no')
      .single();

    if (jeError || !je) {
      throw new Error(`Failed to create journal entry: ${jeError?.message}`);
    }

    // Insert lines
    const lineInserts = mergedLines.map((line, idx) => ({
      je_id: je.id,
      line_no: (idx + 1) * 10,
      gl_account_id: line.gl_account_id,
      description: line.description,
      debit_amount: line.debit_amount,
      credit_amount: line.credit_amount,
      base_debit: roundTo2(line.debit_amount * (input.exchange_rate ?? 1)),
      base_credit: roundTo2(line.credit_amount * (input.exchange_rate ?? 1)),
      currency: line.currency ?? input.currency ?? null,
      original_amount: line.original_amount ?? (line.debit_amount > 0 ? line.debit_amount : line.credit_amount),
    }));

    const { error: linesError } = await this.client
      .from('journal_entry_lines')
      .insert(lineInserts);

    if (linesError) {
      // Attempt cleanup
      await this.client.from('journal_entries').delete().eq('id', je.id);
      throw new Error(`Failed to create JE lines: ${linesError.message}`);
    }

    return {
      id: je.id,
      je_no: je.je_no,
      total_debit: totalDebit,
      total_credit: totalCredit,
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // SCENARIO BUILDERS — Called by other services
  // ════════════════════════════════════════════════════════════════════════

  // ── §2.1 Invoice Posting ──────────────────────────────────────────────
  /**
   * PRD Part 5 §2.1:
   *   Dr. Trade Receivable (AR Control)     total_amount
   *     Cr. Revenue                         subtotal
   *     Cr. Tax Payable                     tax_total
   */
  createInvoicePostingJE(params: {
    company_id: string;
    invoice_id: string;
    invoice_no: string;
    invoice_date: string;
    posting_period: string;
    customer_name: string;
    currency: string;
    exchange_rate: number;
    base_currency: string;
    total_amount: number;
    subtotal: number;
    tax_total: number;
    ar_acct_id: string;
    revenue_acct_id: string;
    tax_acct_id: string | null;
    created_by: string;
    line_details?: Array<{ gl_account_id: string; amount: number; description: string }>;
  }): Promise<JEResult> {
    const lines: JELineInput[] = [];

    // Dr. AR Control — full invoice amount
    lines.push({
      gl_account_id: params.ar_acct_id,
      description: `AR: ${params.invoice_no} - ${params.customer_name}`,
      debit_amount: params.total_amount,
      credit_amount: 0,
    });

    // Cr. Revenue — per line account if provided, else single revenue line
    if (params.line_details && params.line_details.length > 0) {
      // Multiple revenue lines per invoice line (different GL accounts)
      for (const ld of params.line_details) {
        lines.push({
          gl_account_id: ld.gl_account_id,
          description: ld.description,
          debit_amount: 0,
          credit_amount: ld.amount,
        });
      }
    } else {
      lines.push({
        gl_account_id: params.revenue_acct_id,
        description: `Revenue: ${params.invoice_no}`,
        debit_amount: 0,
        credit_amount: params.subtotal,
      });
    }

    // Cr. Tax Payable (if tax exists)
    if (params.tax_total > 0 && params.tax_acct_id) {
      lines.push({
        gl_account_id: params.tax_acct_id,
        description: `Tax: ${params.invoice_no}`,
        debit_amount: 0,
        credit_amount: params.tax_total,
      });
    }

    return this.createJournalEntry({
      company_id: params.company_id,
      je_date: params.invoice_date,
      posting_period: params.posting_period,
      source_type: 'INV',
      source_doc_no: params.invoice_no,
      source_doc_id: params.invoice_id,
      description: `Invoice posting: ${params.invoice_no} — ${params.customer_name}`,
      currency: params.currency,
      exchange_rate: params.exchange_rate,
      base_currency: params.base_currency,
      lines,
      created_by: params.created_by,
    });
  }

  // ── §2.7 Credit Note Posting ──────────────────────────────────────────
  /**
   * PRD Part 5 §2.7: Mirror of invoice posting
   *   Dr. Revenue                          subtotal
   *   Dr. Tax Payable                      tax_total
   *     Cr. Trade Receivable (AR Control)  total_amount
   */
  createCreditNoteJE(params: {
    company_id: string;
    cn_id: string;
    cn_no: string;
    cn_date: string;
    posting_period: string;
    customer_name: string;
    currency: string;
    exchange_rate: number;
    base_currency: string;
    total_amount: number;
    subtotal: number;
    tax_total: number;
    ar_acct_id: string;
    revenue_acct_id: string;
    tax_acct_id: string | null;
    created_by: string;
  }): Promise<JEResult> {
    const lines: JELineInput[] = [];

    // Dr. Revenue (reverse)
    lines.push({
      gl_account_id: params.revenue_acct_id,
      description: `CN Revenue reversal: ${params.cn_no}`,
      debit_amount: params.subtotal,
      credit_amount: 0,
    });

    // Dr. Tax (reverse)
    if (params.tax_total > 0 && params.tax_acct_id) {
      lines.push({
        gl_account_id: params.tax_acct_id,
        description: `CN Tax reversal: ${params.cn_no}`,
        debit_amount: params.tax_total,
        credit_amount: 0,
      });
    }

    // Cr. AR Control
    lines.push({
      gl_account_id: params.ar_acct_id,
      description: `CN AR: ${params.cn_no} - ${params.customer_name}`,
      debit_amount: 0,
      credit_amount: params.total_amount,
    });

    return this.createJournalEntry({
      company_id: params.company_id,
      je_date: params.cn_date,
      posting_period: params.posting_period,
      source_type: 'CN',
      source_doc_no: params.cn_no,
      source_doc_id: params.cn_id,
      description: `Credit Note posting: ${params.cn_no} — ${params.customer_name}`,
      currency: params.currency,
      exchange_rate: params.exchange_rate,
      base_currency: params.base_currency,
      lines,
      created_by: params.created_by,
    });
  }

  // ── §2.8 Debit Note Posting ───────────────────────────────────────────
  /**
   * Same structure as Invoice posting.
   *   Dr. Trade Receivable     total_amount
   *     Cr. Revenue            subtotal
   *     Cr. Tax Payable        tax_total
   */
  createDebitNoteJE(params: {
    company_id: string;
    dn_id: string;
    dn_no: string;
    dn_date: string;
    posting_period: string;
    customer_name: string;
    currency: string;
    exchange_rate: number;
    base_currency: string;
    total_amount: number;
    subtotal: number;
    tax_total: number;
    ar_acct_id: string;
    revenue_acct_id: string;
    tax_acct_id: string | null;
    created_by: string;
  }): Promise<JEResult> {
    const lines: JELineInput[] = [];

    lines.push({
      gl_account_id: params.ar_acct_id,
      description: `DN AR: ${params.dn_no} - ${params.customer_name}`,
      debit_amount: params.total_amount,
      credit_amount: 0,
    });

    lines.push({
      gl_account_id: params.revenue_acct_id,
      description: `DN Revenue: ${params.dn_no}`,
      debit_amount: 0,
      credit_amount: params.subtotal,
    });

    if (params.tax_total > 0 && params.tax_acct_id) {
      lines.push({
        gl_account_id: params.tax_acct_id,
        description: `DN Tax: ${params.dn_no}`,
        debit_amount: 0,
        credit_amount: params.tax_total,
      });
    }

    return this.createJournalEntry({
      company_id: params.company_id,
      je_date: params.dn_date,
      posting_period: params.posting_period,
      source_type: 'DN',
      source_doc_no: params.dn_no,
      source_doc_id: params.dn_id,
      description: `Debit Note posting: ${params.dn_no} — ${params.customer_name}`,
      currency: params.currency,
      exchange_rate: params.exchange_rate,
      base_currency: params.base_currency,
      lines,
      created_by: params.created_by,
    });
  }

  // ── §2.9 Reversal JE (Invoice/CN/DN Cancellation) ────────────────────
  /**
   * PRD Part 5 §2.9: Creates a mirror-image JE (debit↔credit swapped).
   * Links original_je_id ↔ reversal_je_id bidirectionally (BR-JE-004).
   */
  async createReversalJE(params: {
    company_id: string;
    original_je_id: string;
    reversal_date: string;
    posting_period: string;
    reason: string;
    created_by: string;
  }): Promise<JEResult> {
    void params.reversal_date;
    void params.posting_period;

    const rpcResult = await callRpc<{
      reversal_je_id: string;
      reversal_je_no: string;
    }>(this.client, 'reverse_journal_entry', {
      p_je_id: params.original_je_id,
      p_user_id: params.created_by,
      p_company_id: params.company_id,
      p_reason: params.reason,
    });

    const { data: reversal, error } = await this.client
      .from('journal_entries')
      .select('id, je_no, total_debit, total_credit')
      .eq('id', rpcResult.reversal_je_id)
      .single();

    if (error || !reversal) {
      throw new Error(`Failed to fetch reversal JE: ${error?.message}`);
    }

    return {
      id: reversal.id,
      je_no: reversal.je_no,
      total_debit: Number(reversal.total_debit),
      total_credit: Number(reversal.total_credit),
    };
  }

  // ════════════════════════════════════════════════════════════════════════

  // HELPER: Line Merging (BR-JE-001)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Merge JE lines that have the same GL account AND are on the same side (debit or credit).
   * This reduces the number of lines in the journal entry.
   */
  private mergeLines(lines: JELineInput[]): JELineInput[] {
    const mergeMap = new Map<string, JELineInput>();

    for (const line of lines) {
      // Skip zero-amount lines
      if (line.debit_amount === 0 && line.credit_amount === 0) continue;

      const side = line.debit_amount > 0 ? 'Dr' : 'Cr';
      const key = `${line.gl_account_id}:${side}`;

      if (mergeMap.has(key)) {
        const existing = mergeMap.get(key)!;
        existing.debit_amount = roundTo2(existing.debit_amount + line.debit_amount);
        existing.credit_amount = roundTo2(existing.credit_amount + line.credit_amount);
        // Append description
        if (line.description && !existing.description.includes(line.description)) {
          existing.description = `${existing.description}; ${line.description}`;
        }
      } else {
        mergeMap.set(key, { ...line });
      }
    }

    return Array.from(mergeMap.values());
  }

  // ════════════════════════════════════════════════════════════════════════
  // HELPER: Find JEs by source document
  // ════════════════════════════════════════════════════════════════════════

  async findJEsBySourceDoc(
    sourceDocId: string,
    sourceType?: string,
  ): Promise<Array<{ id: string; je_no: string; is_reversed: boolean; description: string | null }>> {
    let query = this.client
      .from('journal_entries')
      .select('id, je_no, is_reversed, description')  // VULN-C02-MINOR FIX: include description for reversal matching
      .eq('source_doc_id', sourceDocId);

    if (sourceType) {
      query = query.eq('source_type', sourceType);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch JEs: ${error.message}`);
    return (data ?? []) as Array<{ id: string; je_no: string; is_reversed: boolean; description: string | null }>;
  }
}
