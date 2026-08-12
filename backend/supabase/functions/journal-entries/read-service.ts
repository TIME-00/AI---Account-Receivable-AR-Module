import type { SupabaseClient } from "supabase";
import type { AuthContext } from "../_shared/auth.ts";
import { throwDatabaseError } from "../_shared/db.ts";
import { NotFoundError } from "../_shared/errors.ts";
import type { JournalListParams } from "./contract.ts";
import { encodeJournalCursor } from "./contract.ts";

export type JournalSourceEntityType =
  | "invoice"
  | "credit_note"
  | "debit_note"
  | "receipt";

export interface JournalListItem {
  id: string;
  je_no: string;
  je_date: string;
  posting_period: string;
  source_type: string;
  source_doc_no: string | null;
  source_doc_id: string | null;
  description: string | null;
  currency: string;
  base_currency: string;
  total_debit: string;
  total_credit: string;
  is_balanced: boolean;
  is_reversal: boolean;
  created_at: string;
  created_by: string | null;
  line_count: number;
  source: {
    entity_type: JournalSourceEntityType;
    entity_id: string;
    entity_number: string;
  } | null;
}

export interface JournalDetail extends JournalListItem {
  exchange_rate: string;
  original_je_id: string | null;
  reversal_je_id: string | null;
  is_reversed: boolean;
  lines: Array<{
    id: string;
    line_no: number;
    gl_account_id: string;
    account_code: string;
    account_name: string;
    account_type: string;
    description: string | null;
    debit_amount: string;
    credit_amount: string;
    base_debit: string;
    base_credit: string;
    currency: string;
    original_amount: string | null;
    created_at: string;
  }>;
}

export interface JournalListResult {
  data: JournalListItem[];
  meta: { limit: number; has_more: boolean; next_cursor: string | null };
}

interface RpcEnvelope<T> {
  rows?: T[];
  has_more?: boolean;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDecimal(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_PATTERN.test(value);
}

function isSource(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return ["invoice", "credit_note", "debit_note", "receipt"].includes(
    String(value.entity_type),
  ) &&
    typeof value.entity_id === "string" && UUID_PATTERN.test(value.entity_id) &&
    typeof value.entity_number === "string" && value.entity_number.length > 0;
}

function isJournalItem(value: unknown): value is JournalListItem {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && UUID_PATTERN.test(value.id) &&
    typeof value.je_no === "string" && typeof value.je_date === "string" &&
    typeof value.posting_period === "string" &&
    typeof value.source_type === "string" &&
    (value.source_doc_no === null || typeof value.source_doc_no === "string") &&
    (value.source_doc_id === null ||
      (typeof value.source_doc_id === "string" &&
        UUID_PATTERN.test(value.source_doc_id))) &&
    (value.description === null || typeof value.description === "string") &&
    typeof value.currency === "string" &&
    typeof value.base_currency === "string" &&
    isDecimal(value.total_debit) && isDecimal(value.total_credit) &&
    typeof value.is_balanced === "boolean" &&
    typeof value.is_reversal === "boolean" &&
    typeof value.created_at === "string" &&
    !Number.isNaN(Date.parse(value.created_at)) &&
    (value.created_by === null ||
      (typeof value.created_by === "string" &&
        UUID_PATTERN.test(value.created_by))) &&
    Number.isSafeInteger(value.line_count) && Number(value.line_count) >= 0 &&
    isSource(value.source);
}

function isJournalDetail(value: unknown): value is JournalDetail {
  if (!isJournalItem(value) || !isRecord(value)) return false;
  if (
    !isDecimal(value.exchange_rate) || typeof value.is_reversed !== "boolean" ||
    (value.original_je_id !== null &&
      (typeof value.original_je_id !== "string" ||
        !UUID_PATTERN.test(value.original_je_id))) ||
    (value.reversal_je_id !== null &&
      (typeof value.reversal_je_id !== "string" ||
        !UUID_PATTERN.test(value.reversal_je_id))) ||
    !Array.isArray(value.lines)
  ) return false;
  return value.lines.every((line) =>
    isRecord(line) && typeof line.id === "string" &&
    UUID_PATTERN.test(line.id) &&
    Number.isSafeInteger(line.line_no) && Number(line.line_no) > 0 &&
    typeof line.gl_account_id === "string" &&
    UUID_PATTERN.test(line.gl_account_id) &&
    typeof line.account_code === "string" &&
    typeof line.account_name === "string" &&
    typeof line.account_type === "string" &&
    (line.description === null || typeof line.description === "string") &&
    isDecimal(line.debit_amount) && isDecimal(line.credit_amount) &&
    isDecimal(line.base_debit) && isDecimal(line.base_credit) &&
    typeof line.currency === "string" &&
    (line.original_amount === null || isDecimal(line.original_amount)) &&
    typeof line.created_at === "string" &&
    !Number.isNaN(Date.parse(line.created_at))
  );
}

function invalidResult(): never {
  throw new Error("Journal read RPC returned an invalid result");
}

export interface JournalReadServiceContract {
  list(
    auth: AuthContext,
    params: JournalListParams,
  ): Promise<JournalListResult>;
  detail(auth: AuthContext, id: string): Promise<JournalDetail>;
}

export class JournalReadService implements JournalReadServiceContract {
  constructor(private readonly client: SupabaseClient) {}

  private async rpc<T>(
    name: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    const { data, error } = await this.client.rpc(name, params);
    if (error) throwDatabaseError(error, `Journal read RPC ${name} failed`);
    return data as T;
  }

  async list(
    auth: AuthContext,
    params: JournalListParams,
  ): Promise<JournalListResult> {
    const envelope = await this.rpc<RpcEnvelope<JournalListItem>>(
      "journal_read_list",
      {
        p_company_id: auth.companyId,
        p_user_id: auth.userId,
        p_limit: params.limit,
        p_cursor_created_at: params.cursor?.created_at ?? null,
        p_cursor_id: params.cursor?.id ?? null,
        p_q: params.q,
        p_date_from: params.dateFrom,
        p_date_to: params.dateTo,
        p_source_type: params.sourceType,
        p_currency: params.currency,
        p_account_code: params.accountCode,
      },
    );
    if (
      !isRecord(envelope) || !Array.isArray(envelope.rows) ||
      typeof envelope.has_more !== "boolean" ||
      envelope.rows.length > params.limit ||
      !envelope.rows.every(isJournalItem)
    ) invalidResult();
    const rows = envelope.rows as JournalListItem[];
    if (envelope.has_more && rows.length === 0) invalidResult();
    const last = rows.at(-1);
    return {
      data: rows,
      meta: {
        limit: params.limit,
        has_more: envelope.has_more,
        next_cursor: envelope.has_more && last
          ? encodeJournalCursor({ created_at: last.created_at, id: last.id })
          : null,
      },
    };
  }

  async detail(auth: AuthContext, id: string): Promise<JournalDetail> {
    const result = await this.rpc<unknown>("journal_read_detail", {
      p_company_id: auth.companyId,
      p_user_id: auth.userId,
      p_journal_entry_id: id,
    });
    if (result === null) throw new NotFoundError("Journal entry", id);
    if (!isJournalDetail(result)) invalidResult();
    const detail = result as JournalDetail;
    if (detail.lines.length !== detail.line_count) invalidResult();
    for (let index = 1; index < detail.lines.length; index += 1) {
      if (detail.lines[index - 1].line_no > detail.lines[index].line_no) {
        invalidResult();
      }
    }
    return detail;
  }
}
