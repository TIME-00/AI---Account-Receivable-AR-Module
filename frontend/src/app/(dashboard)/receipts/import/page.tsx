// ============================================================================
// TSH Synergy AR - CSV/Excel Receipt Import Page (Phase D: Draft Only)
// ============================================================================

"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  FileSpreadsheet,
  Info,
  Loader2,
  RotateCcw,
  ScanLine,
  Table2,
  Upload,
  Wallet,
  XCircle,
  Zap,
} from "lucide-react";
import {
  IMPORT_STEPS,
  summarizeValidationCounts,
  useImport,
  type ImportCustomerResolution,
  type ImportCustomerSuggestion,
  type ImportInvoiceSuggestion,
  type ImportRow,
  type ImportBatch,
} from "@/hooks/use-import";
import { LoadingButton } from "@/components/ui/loading-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { ReviewActions } from "@/components/features/imports/review-actions";
import { OcrImportFlow } from "@/components/features/imports/ocr-import-flow";
import { ImportGovernanceCell } from "@/components/features/imports/import-governance-cell";
import { cn, formatDate } from "@/lib/utils";
import { SUPPORTED_TRANSACTION_CURRENCIES } from "@/lib/currency";

// Import channel: existing CSV/Excel wizard vs. Batch 9C PDF/Image intake.
type ImportMode = "csv" | "ocr";

const RECEIPT_COLUMNS = [
  { name: "customer_code", required: false, description: "Optional existing visible customer code. Unknown codes are rejected." },
  { name: "customer_name", required: false, description: "Required when customer_code is blank. Used to match or create a visible customer." },
  { name: "registration_no", required: false, description: "Required when creating a new Corporate customer." },
  { name: "bill_addr_line1", required: false, description: "Required when creating a new customer." },
  { name: "bill_city", required: false, description: "Required when creating a new customer." },
  { name: "bill_state", required: false, description: "Required when creating a new customer." },
  { name: "bill_postal", required: false, description: "Required when creating a new customer." },
  { name: "bill_country", required: false, description: "Required when creating a new customer. Use ISO code such as SG or MY." },
  { name: "contact_name", required: false, description: "Required when creating a new customer." },
  { name: "contact_phone", required: false, description: "Required when creating a new customer." },
  { name: "contact_email", required: false, description: "Required when creating a new customer." },
  { name: "receipt_date", required: true, description: "Date format: YYYY-MM-DD." },
  {
    name: "currency",
    required: false,
    description:
      "3-letter ISO code. Defaults from customer/country where possible. " +
      `New receipts accept only ${SUPPORTED_TRANSACTION_CURRENCIES.join(" or ")}; ` +
      "rows in other currencies are rejected.",
  },
  { name: "receipt_reference", required: false, description: "Bank transfer reference or cheque number. Required for CHQ." },
  { name: "payment_method", required: true, description: "Existing method code: CHQ, TT, CASH, CC, GIRO, OFST, or ONLN." },
  { name: "bank_account_code", required: false, description: "Bank account number from bank_accounts.account_no." },
  { name: "bank_account_id", required: false, description: "Optional backend UUID. Use this when account number is unavailable." },
  { name: "amount", required: true, description: "Positive receipt amount." },
  { name: "cheque_date", required: false, description: "Required only when payment_method is CHQ. Do not fake this date." },
  { name: "remarks", required: false, description: "Optional internal receipt remarks." },
  { name: "invoice_reference", required: false, description: "Optional exact invoice_no for one-receipt-to-one-invoice allocation." },
  { name: "allocation_amount", required: false, description: "Optional allocation amount. Requires invoice_reference and cannot exceed receipt amount." },
  { name: "discount_amount", required: false, description: "Optional explicit sales discount. Never inferred from a short payment." },
  { name: "bank_charge_amount", required: false, description: "Optional diagnostic-only bank charge amount. Not posted as discount." },
  { name: "short_payment_reason", required: false, description: "Optional reason such as bank_charge. Bank charges require review." },
];

const SAMPLE_CSV = `customer_code,customer_name,registration_no,bill_addr_line1,bill_city,bill_state,bill_postal,bill_country,contact_name,contact_phone,contact_email,receipt_date,currency,receipt_reference,payment_method,bank_account_code,bank_account_id,amount,cheque_date,remarks,invoice_reference,allocation_amount,discount_amount,bank_charge_amount,short_payment_reason
CUST-001,,,,,,,,,,,2026-05-28,SGD,TT-REF-001,TT,5141-2200-0001,,100.00,,Bank transfer receipt,INV-202605-00001,100.00,,,
,New Receipt Client Pte Ltd,202612346N,10 Anson Road,Downtown Core,Central,079903,SG,Alex Tan,+6561234567,alex.receipts@example.com,2026-05-28,SGD,CHQ-0001,CHQ,5141-2200-0001,,250.00,2026-05-27,Cheque receipt,,,,`;

const ROW_STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  Pending: { bg: "bg-slate-100", text: "text-slate-600", dot: "bg-slate-400" },
  Valid: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  Error: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500" },
  Skipped: { bg: "bg-gray-100", text: "text-gray-500", dot: "bg-gray-400" },
  Created: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500" },
  Posted: { bg: "bg-purple-50", text: "text-purple-700", dot: "bg-purple-500" },
  Allocated: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  Unmatched: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
};

export default function ReceiptImportPage() {
  const {
    step,
    batch,
    rows,
    isLoading,
    error,
    reviewLoading,
    uploadAndValidate,
    executeBatch,
    reviewImportRow,
    reset,
  } = useImport("receipt");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<ImportMode>("csv");
  // Batch 6C UX Fix: Auto-Post & Allocate defaults ON for receipts (frontend
  // default only; execution still runs through verified backend RPCs).
  const [autoPost, setAutoPost] = useState(true);
  const currentStepIndex = IMPORT_STEPS.findIndex((s) => s.key === step);

  // Non-overlapping presentation counts (active review vs. error/unmatched/skipped).
  const { needsReview: needsReviewCount, errors: errorCount } = summarizeValidationCounts(rows);

  const handleFile = useCallback(
    (file: File) => {
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (ext !== "csv" && ext !== "xlsx") {
        toast.error("Unsupported File", { description: "Only .csv and .xlsx files are supported." });
        return;
      }
      const maxSize = ext === "xlsx" ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
      const maxLabel = ext === "xlsx" ? "10 MB" : "5 MB";
      if (file.size > maxSize) {
        toast.error("File Too Large", { description: `Maximum file size for .${ext} is ${maxLabel}.` });
        return;
      }
      // Batch 6C UX Fix: upload then auto parse + validate in one action.
      uploadAndValidate(file);
    },
    [uploadAndValidate],
  );

  const copyTemplate = useCallback(() => {
    navigator.clipboard.writeText(SAMPLE_CSV);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/receipts" className="mb-1 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600">
            <ArrowLeft className="h-3.5 w-3.5" />
            Receipts
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900">
            <FileSpreadsheet className="h-6 w-6 text-emerald-500" />
            Receipt Import
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {mode === "csv"
              ? "CSV/Excel Receipt Import — Auto-Post & Allocate is ON by default (turn it off on the Validate step for draft-only)"
              : "PDF/Image Receipt Import — Review & Draft Only (no posting, no allocation, no final financial records)"}
          </p>
        </div>
        {mode === "csv" && step !== "upload" && step !== "result" && (
          <LoadingButton variant="ghost" size="sm" onClick={reset}>
            <RotateCcw className="h-3.5 w-3.5" />
            Start Over
          </LoadingButton>
        )}
      </div>

      {/* Import channel toggle: existing CSV/Excel wizard vs. PDF/Image intake */}
      <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
        <button
          type="button"
          onClick={() => setMode("csv")}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            mode === "csv" ? "bg-surface text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-700",
          )}
        >
          <FileSpreadsheet className="h-4 w-4" />
          CSV / Excel
        </button>
        <button
          type="button"
          onClick={() => setMode("ocr")}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            mode === "ocr" ? "bg-surface text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-700",
          )}
        >
          <ScanLine className="h-4 w-4" />
          PDF/Image Import
        </button>
      </div>

      {/* PDF/Image receipt intake (Batch 9C) — review/draft only, never posts or
          allocates. Mutually exclusive with the CSV/XLSX wizard below. */}
      {mode === "ocr" && (
        <>
          <div className="rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-blue-50 p-4">
            <div className="flex items-start gap-3">
              <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-indigo-500" />
              <div className="text-sm">
                <p className="font-semibold text-indigo-800">Receipt PDF/Image Import is intake / review-draft only</p>
                <ul className="mt-1 space-y-0.5 text-indigo-700">
                  <li>• It <strong>does not post receipts</strong>.</li>
                  <li>• It <strong>does not allocate to invoices</strong>.</li>
                  <li>• It <strong>creates no final financial records</strong>.</li>
                  <li>• To post and allocate receipts, use the <strong>CSV / Excel</strong> channel.</li>
                </ul>
              </div>
            </div>
          </div>
          <OcrImportFlow importType="receipt" />
        </>
      )}

      {mode === "csv" && (
        <>
      <div className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
          <div className="text-sm">
            <p className="font-semibold text-amber-800">Auto-Post &amp; Allocate is ON by default</p>
            <ul className="mt-1 space-y-0.5 text-amber-700">
              <li><strong>Auto-Post &amp; Allocate is enabled by default.</strong> On execution, valid receipts are posted and exact invoice references are allocated using verified financial RPCs — this is not a draft-only import.</li>
              <li>To create <strong>Draft</strong> receipts only, turn off <strong>Auto-Post &amp; Allocate</strong> on the Validate step before executing.</li>
              <li>CSV and Excel (.xlsx) files are supported here. For a receipt <strong>PDF or image</strong>, switch to the <strong>PDF/Image Import</strong> channel above — that path is review/draft only and never posts receipts or allocates to invoices.</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="glass-card p-4">
        <div className="flex items-center gap-1">
          {IMPORT_STEPS.map((s, i) => {
            const isActive = s.key === step;
            const isPast = i < currentStepIndex;
            return (
              <div key={s.key} className="flex flex-1 items-center">
                <div className="flex flex-1 items-center gap-2">
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all",
                      isActive && "scale-110 bg-accent-fill text-white shadow-md shadow-brand-200/50",
                      isPast && "bg-emerald-500 text-white",
                      !isActive && !isPast && "bg-slate-200 text-slate-400",
                    )}
                  >
                    {isPast ? <Check className="h-4 w-4" /> : s.number}
                  </div>
                  <span className={cn("hidden text-xs font-medium sm:inline", isActive && "text-brand-700", isPast && "text-emerald-600", !isActive && !isPast && "text-slate-400")}>
                    {s.label}
                  </span>
                </div>
                {i < IMPORT_STEPS.length - 1 && (
                  <div className={cn("mx-2 h-0.5 flex-1 rounded-full", isPast ? "bg-emerald-400" : "bg-slate-200")} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <XCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
          <div>
            <p className="font-medium text-red-800">Error</p>
            <p className="mt-0.5 text-sm text-red-700">{error}</p>
          </div>
        </div>
      )}

      <div className="glass-card p-6">
        {step === "upload" && (
          <div className="space-y-6">
            <div
              className={cn(
                "relative cursor-pointer rounded-2xl border-2 border-dashed p-12 text-center transition-all",
                dragActive ? "border-brand-500 bg-brand-50/50" : "border-slate-300 hover:border-brand-400 hover:bg-brand-50/30",
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleFile(file);
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              />
              <div className="flex flex-col items-center gap-4">
                <div className={cn("rounded-2xl p-4", dragActive ? "bg-brand-100" : "bg-slate-100")}>
                  <Upload className={cn("h-10 w-10", dragActive ? "text-brand-600" : "text-slate-400")} />
                </div>
                <div>
                  <p className="text-lg font-semibold text-slate-700">
                    {dragActive ? "Drop file here" : "Drag & drop receipt CSV or Excel file here"}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    or <span className="font-medium text-brand-600">click to browse</span> .csv (5 MB) / .xlsx (10 MB)
                  </p>
                </div>
              </div>
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-surface/80">
                  <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
                  <span className="ml-3 text-sm font-medium text-slate-600">Uploading...</span>
                </div>
              )}
            </div>

            <div>
              <button
                onClick={() => setShowTemplate(!showTemplate)}
                className="inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700"
              >
                <Info className="h-4 w-4" />
                {showTemplate ? "Hide" : "Show"} receipt import template & column guide
              </button>

              {showTemplate && (
                <div className="mt-4 space-y-4">
                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <div className="border-b border-slate-200 bg-slate-50 px-4 py-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Supported Columns</p>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {RECEIPT_COLUMNS.map((col) => (
                        <div key={col.name} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                          <code className="min-w-[140px] rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">{col.name}</code>
                          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", col.required ? "bg-red-50 text-red-500" : "bg-slate-50 text-slate-400")}>
                            {col.required ? "Required" : "Optional"}
                          </span>
                          <span className="text-slate-600">{col.description}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Sample CSV</p>
                      <button onClick={copyTemplate} className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700">
                        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        {copied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    <pre className="overflow-x-auto bg-surface p-4 font-mono text-xs leading-relaxed text-slate-700">{SAMPLE_CSV}</pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {step === "validate" && batch && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">Validation Complete</h2>
                <p className="text-sm text-slate-500">Review results, then create draft receipts for valid rows.</p>
              </div>
              <label className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <input
                  type="checkbox"
                  checked={autoPost}
                  onChange={(e) => setAutoPost(e.target.checked)}
                  className="h-4 w-4 rounded border-amber-300 text-brand-600"
                />
                Auto-Post & Allocate
              </label>
              <LoadingButton
                variant="primary"
                size="md"
                isLoading={isLoading}
                loadingText={autoPost ? "Posting & Allocating..." : "Creating Draft Receipts..."}
                disabled={batch.valid_rows === 0}
                onClick={() => executeBatch(batch.id, { autoPost })}
              >
                <Zap className="h-4 w-4" />
                {autoPost
                  ? `Create, Post & Allocate ${batch.valid_rows} Receipt${batch.valid_rows !== 1 ? "s" : ""}`
                  : `Create ${batch.valid_rows} Draft Receipt${batch.valid_rows !== 1 ? "s" : ""}`}
              </LoadingButton>
            </div>
            {autoPost && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Receipts will be posted immediately. Posted receipts with exact invoice references will be allocated. This creates financial entries through verified P1 RPCs and cannot be treated as a draft-only import.
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <SummaryCard label="Valid Rows" value={batch.valid_rows} color="emerald" />
              <SummaryCard label="Needs Review" value={needsReviewCount} color="amber" />
              <SummaryCard label="Error Rows" value={errorCount} color="red" />
              <SummaryCard label="Total Rows" value={batch.total_rows} color="slate" />
            </div>
            <RowsTable
              rows={rows}
              showValidation
              batch={batch}
              reviewImportRow={reviewImportRow}
              reviewLoading={reviewLoading}
            />
          </div>
        )}

        {step === "result" && batch && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="mb-4 inline-flex rounded-2xl bg-emerald-100 p-4">
                <CheckCircle2 className="h-10 w-10 text-emerald-600" />
              </div>
              <h2 className="text-xl font-bold text-slate-800">Import Complete</h2>
              <p className="mt-1 text-sm text-slate-500">Import execution is complete. Review posted and allocated counts before continuing.</p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <SummaryCard label="Draft Receipts Created" value={batch.created_count} color="blue" />
              <SummaryCard label="Errors" value={batch.error_rows} color="red" />
              <SummaryCard label="Posted" value={batch.posted_count} color="purple" />
              <SummaryCard label="Allocated" value={batch.allocated_count} color="emerald" />
              <SummaryCard label="Matched Customers" value={batch.matched_customers_count} color="emerald" />
              <SummaryCard label="Created Customers" value={batch.created_customers_count} color="blue" />
            </div>

            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              <MetaRow label="Batch ID" value={batch.id} mono />
              <MetaRow label="File" value={batch.file_name} />
              <MetaRow label="Status" value={batch.status} badge />
              <MetaRow label="Total Rows" value={String(batch.total_rows)} />
              <MetaRow label="Created At" value={formatDate(batch.created_at)} />
              {batch.completed_at && <MetaRow label="Completed At" value={formatDate(batch.completed_at)} />}
            </div>

            <RowsTable
              rows={rows}
              showValidation
              showResult
              batch={batch}
              reviewImportRow={reviewImportRow}
              reviewLoading={reviewLoading}
            />

            <div className="flex items-center justify-between pt-2">
              <LoadingButton variant="secondary" size="md" onClick={reset}>
                <RotateCcw className="h-4 w-4" />
                Import Another File
              </LoadingButton>
              <Link href="/receipts">
                <LoadingButton variant="primary" size="md">
                  <Eye className="h-4 w-4" />
                  View Receipts
                </LoadingButton>
              </Link>
            </div>
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value, color, suffix }: { label: string; value: number; color: string; suffix?: string }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-xl border p-4", `border-${color}-200 bg-${color}-50/50`)}>
      <Wallet className="h-5 w-5 text-slate-500" />
      <div>
        <p className="text-2xl font-bold text-slate-800">{value}</p>
        <p className="text-xs text-slate-500">
          {label}
          {suffix && <span className="ml-1 text-slate-400">({suffix})</span>}
        </p>
      </div>
    </div>
  );
}

function MetaRow({ label, value, mono, badge }: { label: string; value: string; mono?: boolean; badge?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-sm text-slate-500">{label}</span>
      {badge ? (
        <StatusBadge status={value} />
      ) : (
        <span className={cn("text-sm font-medium text-slate-800", mono && "font-mono text-xs")}>{value}</span>
      )}
    </div>
  );
}

function RowStatusBadge({ status }: { status: string }) {
  const config = ROW_STATUS_COLORS[status] ?? ROW_STATUS_COLORS.Pending;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium", config.bg, config.text)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", config.dot)} />
      {status}
    </span>
  );
}

function RowsTable({
  rows,
  showValidation,
  showResult,
  batch,
  reviewImportRow,
  reviewLoading,
}: {
  rows: ImportRow[];
  showValidation?: boolean;
  showResult?: boolean;
  /**
   * B9DD-RR-005: the whole batch, not just its id — it is the authoritative
   * import-origin envelope (`import_type` + `file_type`) for every row shown.
   */
  batch?: ImportBatch | null;
  reviewImportRow?: ReturnType<typeof useImport>["reviewImportRow"];
  reviewLoading?: ReturnType<typeof useImport>["reviewLoading"];
}) {
  const batchId = batch?.id;
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 p-8 text-center">
        <Table2 className="mx-auto mb-2 h-8 w-8 text-slate-300" />
        <p className="text-sm text-slate-500">No rows to display</p>
      </div>
    );
  }

  const rawKeys = rows[0]?.raw_data ? Object.keys(rows[0].raw_data) : [];

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr>
              <th className="w-12 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">#</th>
              {showValidation && <th className="w-24 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>}
              {rawKeys.map((key) => (
                <th key={key} className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {key}
                </th>
              ))}
              {showValidation && (
                <>
                  <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Customer Action</th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Customer Name</th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Customer Code</th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Receipt Reference</th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Amount</th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Allocation</th>
                  {/* B9DD-FEIR-008: FX / import governance provenance */}
                  <th className="min-w-[220px] px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Currency &amp; FX governance</th>
                  <th className="min-w-[220px] px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Errors</th>
                </>
              )}
              {showResult && <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Receipt ID</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const hasErrors = row.status === "Error" && row.validation_errors?.length;
              const resolution = row.mapped_data?.customer_resolution as ImportCustomerResolution | undefined;
              const errorFields = row.validation_errors?.map((e) => e.field) ?? [];
              const reviewRequired = row.mapped_data?.review_required === true;
              const autoPostBlockReason = row.mapped_data?.auto_post_block_reason;
              const unappliedAmount = row.mapped_data?.unapplied_amount;
              const allocationSuggestion = row.mapped_data?.allocation_suggestion;
              const allocationError = row.mapped_data?.allocation_error;
              const allocationErrorReason = row.mapped_data?.allocation_error_reason;
              const shortPaymentDetected = row.mapped_data?.short_payment_detected === true;
              const differenceAmount = row.mapped_data?.difference_amount;
              const suggestedReason = row.mapped_data?.suggested_reason;
              const discountAmount = row.mapped_data?.discount_amount;
              const bankChargePostingRequired = row.mapped_data?.bank_charge_posting_required === true;
              const bankChargeReviewReason = row.mapped_data?.bank_charge_review_reason;
              return (
                <tr key={row.id} className={cn("transition-colors", hasErrors ? "bg-red-50/50" : reviewRequired ? "bg-amber-50/50" : "hover:bg-slate-50")}>
                  <td className="px-3 py-2 font-mono text-xs text-slate-400">{row.row_number}</td>
                  {showValidation && (
                    <td className="px-3 py-2">
                      <RowStatusBadge status={row.status} />
                    </td>
                  )}
                  {rawKeys.map((key) => {
                    const val = row.raw_data?.[key];
                    const hasFieldError = errorFields.includes(key);
                    return (
                      <td key={key} className={cn("max-w-[200px] truncate whitespace-nowrap px-3 py-2 text-slate-700", hasFieldError && "font-medium text-red-700")} title={String(val ?? "")}>
                        {hasFieldError && <AlertTriangle className="mr-1 inline h-3 w-3 text-red-500" />}
                        {val != null ? String(val) : "-"}
                      </td>
                    );
                  })}
                  {showValidation && (
                    <>
                      <td className="whitespace-nowrap px-3 py-2 text-xs font-medium text-slate-700">{resolution?.action ?? (hasErrors ? "Error" : "-")}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-700">{resolution?.customer_name ?? String(row.raw_data?.customer_name || "-")}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-600">{resolution?.customer_code ?? "-"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-700">{String(row.raw_data?.receipt_reference || "-")}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-700">{String(row.raw_data?.amount || "-")}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-700">
                        <div className="space-y-1">
                          <p className={cn("font-medium", reviewRequired && "text-amber-700")}>
                            {String(row.mapped_data?.allocation_status || "-")}
                            {row.mapped_data?.invoice_no ? ` (${String(row.mapped_data.invoice_no)})` : ""}
                          </p>
                          {reviewRequired && (
                            <p className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                              Review required
                            </p>
                          )}
                          {reviewRequired && <SuggestionDiagnostics mappedData={row.mapped_data} compact />}
                          {discountAmount !== undefined && Number(discountAmount) > 0 && (
                            <p className="text-[10px] text-purple-600">Explicit discount: {String(discountAmount)}</p>
                          )}
                          {shortPaymentDetected && (
                            <p className="text-[10px] text-amber-700">
                              Short payment: {String(differenceAmount ?? "-")}
                              {suggestedReason ? ` (${String(suggestedReason)})` : ""}
                            </p>
                          )}
                          {bankChargePostingRequired && (
                            <p className="text-[10px] font-medium text-amber-700">Bank charge review required</p>
                          )}
                          {allocationSuggestion !== undefined && (
                            <p className="text-[10px] text-slate-500">Suggested allocation: {String(allocationSuggestion)}</p>
                          )}
                          {unappliedAmount !== undefined && (
                            <p className="text-[10px] text-slate-500">Unapplied balance: {String(unappliedAmount)}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <ImportGovernanceCell mappedData={row.mapped_data} batch={batch} />
                      </td>
                      <td className="px-3 py-2">
                        {row.validation_errors?.length ? (
                          <div className="space-y-0.5">
                            {row.validation_errors.map((err, i) => (
                              <p key={i} className="text-xs text-red-600">
                                {err.field && <code className="mr-1 rounded bg-red-100 px-1 font-mono">{err.field}</code>}
                                {err.message ?? err.error ?? "Validation error"}
                              </p>
                            ))}
                          </div>
                        ) : reviewRequired ? (
                          <div className="space-y-0.5">
                            <p className="text-xs text-amber-700">
                              <code className="mr-1 rounded bg-amber-100 px-1 font-mono">review_required</code>
                              {String(bankChargeReviewReason || autoPostBlockReason || "Row needs manual review before posting/allocation.")}
                            </p>
                            <SuggestionDiagnostics mappedData={row.mapped_data} />
                            {batchId && reviewImportRow && reviewLoading && (
                              <ReviewActions
                                batchId={batchId}
                                row={row}
                                reviewLoading={reviewLoading}
                                reviewImportRow={reviewImportRow}
                              />
                            )}
                          </div>
                        ) : row.status === "Unmatched" && allocationError ? (
                          <div className="space-y-0.5">
                            <p className="text-xs text-amber-700">
                              {allocationErrorReason != null && (
                                <code className="mr-1 rounded bg-amber-100 px-1 font-mono">
                                  {String(allocationErrorReason)}
                                </code>
                              )}
                              {String(allocationError)}
                            </p>
                          </div>
                        ) : row.status === "Valid" ? (
                          <span className="text-xs text-emerald-600">Valid</span>
                        ) : null}
                      </td>
                    </>
                  )}
                  {showResult && (
                    <td className="px-3 py-2">
                      {row.receipt_id ? (
                        <Link href={`/receipts/${row.receipt_id}`} className="font-mono text-xs text-brand-600 hover:text-brand-700">
                          {row.receipt_id.slice(0, 8)}...
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-400">-</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SuggestionDiagnostics({
  mappedData,
  compact = false,
}: {
  mappedData: Record<string, unknown> | null;
  compact?: boolean;
}) {
  const customers = suggestionArray<ImportCustomerSuggestion>(mappedData, "suggested_customers", "customer_candidates");
  const invoices = suggestionArray<ImportInvoiceSuggestion>(mappedData, "suggested_invoices", "invoice_candidates");
  const reason = String(mappedData?.suggestion_reason ?? mappedData?.allocation_error_reason ?? "manual_review_required");
  const confidence = mappedData?.confidence ?? mappedData?.match_confidence;

  if (customers.length === 0 && invoices.length === 0) return null;

  return (
    <div className={cn("space-y-1", compact ? "text-[10px]" : "text-xs")}>
      {!compact && (
        <p className="font-medium text-amber-700">
          Suggested match
          {confidence !== undefined ? ` - ${Math.round(Number(confidence) * 100)}% confidence` : ""}
        </p>
      )}
      <p className="text-amber-700">Reason: {reason}</p>
      {customers.length > 0 && (
        <div className="space-y-0.5">
          <p className="font-medium text-slate-600">Suggested customer</p>
          {customers.map((customer) => (
            <p key={customer.customer_id} className="text-slate-600">
              {customer.customer_code} - {customer.customer_name} ({Math.round(Number(customer.confidence) * 100)}%, {customer.reason})
            </p>
          ))}
        </div>
      )}
      {invoices.length > 0 && (
        <div className="space-y-0.5">
          <p className="font-medium text-slate-600">Suggested invoice</p>
          {invoices.map((invoice) => (
            <p key={invoice.invoice_id} className={cn("text-slate-600", invoice.allocatable === false && "text-slate-400")}>
              {invoice.invoice_no} ({Math.round(Number(invoice.confidence) * 100)}%, {invoice.reason})
              {invoice.outstanding !== undefined ? ` - outstanding ${String(invoice.outstanding)}` : ""}
              {invoice.currency ? ` ${invoice.currency}` : ""}
              {invoice.allocatable === false ? " - not allocatable" : ""}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function suggestionArray<T>(mappedData: Record<string, unknown> | null, preferred: string, fallback: string): T[] {
  const value = mappedData?.[preferred] ?? mappedData?.[fallback];
  return Array.isArray(value) ? value as T[] : [];
}
