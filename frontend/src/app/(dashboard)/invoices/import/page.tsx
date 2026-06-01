// ============================================================================
// TSH Synergy AR — CSV Invoice Import Page (Phase A: Draft Only)
// Multi-step wizard: Upload → Parse → Preview → Validate → Execute → Result
// ============================================================================

"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  useImport,
  IMPORT_STEPS,
  type ImportStep,
  type ImportRow,
  type ImportCustomerResolution,
  type ImportBatchStatus,
} from "@/hooks/use-import";
import { StatusBadge } from "@/components/ui/status-badge";
import { LoadingButton } from "@/components/ui/loading-button";
import { cn, formatDate } from "@/lib/utils";
import {
  Upload, FileText, ChevronLeft, ChevronRight, CheckCircle2,
  XCircle, AlertTriangle, Loader2, ArrowLeft, RotateCcw,
  FileSpreadsheet, Info, Copy, Eye, Check, Table2, Zap,
} from "lucide-react";

// ─── CSV Template ───────────────────────────────────────────────────────────

const CSV_COLUMNS = [
  { name: "customer_code", required: false, description: "Optional existing visible customer code. Leave blank to match or create by customer name." },
  { name: "customer_name", required: false, description: "Required when customer_code is blank. Used for visible company-scoped matching or creation." },
  { name: "registration_no", required: false, description: "Required when creating a new Corporate customer." },
  { name: "bill_addr_line1", required: false, description: "Required when creating a new customer." },
  { name: "bill_city", required: false, description: "Required when creating a new customer." },
  { name: "bill_state", required: false, description: "Required when creating a new customer." },
  { name: "bill_postal", required: false, description: "Required when creating a new customer." },
  { name: "bill_country", required: false, description: "Required when creating a new customer. Use ISO code such as SG or MY." },
  { name: "contact_name", required: false, description: "Required when creating a new customer." },
  { name: "contact_phone", required: false, description: "Required when creating a new customer." },
  { name: "contact_email", required: false, description: "Required when creating a new customer." },
  { name: "invoice_date", required: true, description: "Date format: YYYY-MM-DD" },
  { name: "currency", required: false, description: "3-letter ISO code (default: MYR)" },
  { name: "description", required: true, description: "Line item description" },
  { name: "quantity", required: true, description: "Positive integer or decimal" },
  { name: "unit_price", required: true, description: "Positive number, max 2 decimals" },
  { name: "tax_rate", required: false, description: "0–100 (default: 0)" },
  { name: "reference_no", required: false, description: "External reference number" },
];

const SAMPLE_CSV = `customer_code,customer_name,registration_no,bill_addr_line1,bill_city,bill_state,bill_postal,bill_country,contact_name,contact_phone,contact_email,invoice_date,currency,description,quantity,unit_price,tax_rate,reference_no
CUST-001,,,,,,,,,,,2026-05-28,SGD,Consulting Services,1,5000.00,0,REF-001
,New Client Pte Ltd,202612345N,10 Anson Road,Downtown Core,Central,079903,SG,Alex Tan,+6561234567,alex@example.com,2026-05-28,SGD,Implementation Services,1,1200.00,0,REF-002`;

// ─── Status Colors ──────────────────────────────────────────────────────────

const ROW_STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  Pending:   { bg: "bg-slate-100",   text: "text-slate-600",   dot: "bg-slate-400" },
  Valid:     { bg: "bg-emerald-50",  text: "text-emerald-700", dot: "bg-emerald-500" },
  Error:     { bg: "bg-red-50",      text: "text-red-700",     dot: "bg-red-500" },
  Skipped:   { bg: "bg-gray-100",    text: "text-gray-500",    dot: "bg-gray-400" },
  Created:   { bg: "bg-blue-50",     text: "text-blue-700",    dot: "bg-blue-500" },
  Unmatched: { bg: "bg-amber-50",    text: "text-amber-700",   dot: "bg-amber-500" },
};

const BATCH_STATUS_COLORS: Record<string, string> = {
  Uploaded:   "text-slate-600",
  Parsing:    "text-blue-600",
  Parsed:     "text-blue-600",
  Validating: "text-amber-600",
  Validated:  "text-emerald-600",
  Executing:  "text-indigo-600",
  Completed:  "text-emerald-600",
  Failed:     "text-red-600",
  Cancelled:  "text-gray-500",
};

// ─── Page Component ─────────────────────────────────────────────────────────

export default function InvoiceImportPage() {
  const {
    step, setStep, batch, rows, isLoading, error,
    uploadFile, parseBatch, validateBatch, executeBatch, reset,
  } = useImport();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [copied, setCopied] = useState(false);

  // ── File handling ────────────────────────────────────────────────────

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
      uploadFile(file);
    },
    [uploadFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      // Reset input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [handleFile]
  );

  const copyTemplate = useCallback(() => {
    navigator.clipboard.writeText(SAMPLE_CSV);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  }, []);

  // ── Step progress bar ────────────────────────────────────────────────

  const currentStepIndex = IMPORT_STEPS.findIndex((s) => s.key === step);

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              href="/invoices"
              className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Invoices
            </Link>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <FileSpreadsheet className="h-6 w-6 text-brand-500" />
            Invoice Import
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            CSV/Excel Invoice Import — Draft Only
          </p>
        </div>
        {step !== "upload" && step !== "result" && (
          <LoadingButton variant="ghost" size="sm" onClick={reset}>
            <RotateCcw className="h-3.5 w-3.5" />
            Start Over
          </LoadingButton>
        )}
      </div>

      {/* Draft-Only Warning Banner */}
      <div className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-semibold text-amber-800">Draft Creation Only</p>
            <ul className="mt-1 space-y-0.5 text-amber-700">
              <li>• Created invoices remain <strong>Draft</strong> — they are not posted.</li>
              <li>• Receipt import is not available yet.</li>
              <li>• Payment allocation is not available yet.</li>
              <li>• CSV and Excel (.xlsx) files are supported. PDF/Image coming in later phases.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Step Progress */}
      <div className="glass-card p-4">
        <div className="flex items-center gap-1">
          {IMPORT_STEPS.map((s, i) => {
            const isActive = s.key === step;
            const isPast = i < currentStepIndex;
            const isFuture = i > currentStepIndex;
            return (
              <div key={s.key} className="flex items-center flex-1">
                <div className="flex items-center gap-2 flex-1">
                  <div
                    className={cn(
                      "h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300",
                      isActive && "bg-brand-600 text-white shadow-md shadow-brand-200/50 scale-110",
                      isPast && "bg-emerald-500 text-white",
                      isFuture && "bg-slate-200 text-slate-400"
                    )}
                  >
                    {isPast ? <Check className="h-4 w-4" /> : s.number}
                  </div>
                  <span
                    className={cn(
                      "text-xs font-medium hidden sm:inline",
                      isActive && "text-brand-700",
                      isPast && "text-emerald-600",
                      isFuture && "text-slate-400"
                    )}
                  >
                    {s.label}
                  </span>
                </div>
                {i < IMPORT_STEPS.length - 1 && (
                  <div
                    className={cn(
                      "h-0.5 flex-1 mx-2 rounded-full transition-colors",
                      isPast ? "bg-emerald-400" : "bg-slate-200"
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <XCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium text-red-800">Error</p>
            <p className="mt-0.5 text-sm text-red-700">{error}</p>
          </div>
        </div>
      )}

      {/* Step Content */}
      <div className="glass-card p-6">
        {/* ── Step 1: Upload ──────────────────────────────────────────── */}
        {step === "upload" && (
          <div className="space-y-6">
            {/* Drop zone */}
            <div
              className={cn(
                "relative rounded-2xl border-2 border-dashed p-12 text-center transition-all duration-200 cursor-pointer",
                dragActive
                  ? "border-brand-500 bg-brand-50/50"
                  : "border-slate-300 hover:border-brand-400 hover:bg-brand-50/30"
              )}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx"
                className="hidden"
                onChange={handleFileInput}
              />
              <div className="flex flex-col items-center gap-4">
                <div className={cn(
                  "rounded-2xl p-4 transition-colors",
                  dragActive ? "bg-brand-100" : "bg-slate-100"
                )}>
                  <Upload className={cn(
                    "h-10 w-10",
                    dragActive ? "text-brand-600" : "text-slate-400"
                  )} />
                </div>
                <div>
                  <p className="text-lg font-semibold text-slate-700">
                    {dragActive ? "Drop file here" : "Drag & drop CSV or Excel file here"}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    or <span className="text-brand-600 font-medium">click to browse</span> · .csv (5 MB) / .xlsx (10 MB)
                  </p>
                </div>
              </div>
              {isLoading && (
                <div className="absolute inset-0 rounded-2xl bg-white/80 flex items-center justify-center">
                  <Loader2 className="h-8 w-8 text-brand-500 animate-spin" />
                  <span className="ml-3 text-sm font-medium text-slate-600">Uploading...</span>
                </div>
              )}
            </div>

            {/* Import Template Guide */}
            <div>
              <button
                onClick={() => setShowTemplate(!showTemplate)}
                className="inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors"
              >
                <Info className="h-4 w-4" />
                {showTemplate ? "Hide" : "Show"} import template & column guide
                <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", showTemplate && "rotate-90")} />
              </button>

              {showTemplate && (
                <div className="mt-4 space-y-4">
                  {/* Column reference */}
                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Required Columns</p>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {CSV_COLUMNS.map((col) => (
                        <div key={col.name} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                          <code className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-700 min-w-[130px]">
                            {col.name}
                          </code>
                          {col.required ? (
                            <span className="text-[10px] font-bold uppercase tracking-wider text-red-500 bg-red-50 px-1.5 py-0.5 rounded">
                              Required
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded">
                              Optional
                            </span>
                          )}
                          <span className="text-slate-600">{col.description}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Sample CSV */}
                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex items-center justify-between">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Sample CSV</p>
                      <button
                        onClick={copyTemplate}
                        className="inline-flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 font-medium transition-colors"
                      >
                        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        {copied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    <pre className="p-4 text-xs font-mono text-slate-700 overflow-x-auto bg-white leading-relaxed">
                      {SAMPLE_CSV}
                    </pre>
                  </div>

                  <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 flex items-start gap-2">
                    <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-blue-700 space-y-1">
                      <p><strong>customer_code</strong> is optional. Use an existing visible system-generated code when available, or leave it blank so the system can match or create the customer from the supplied customer master fields.</p>
                      <p>New customers are created through the backend customer service during draft execution only. Validation remains read-only.</p>
                      <p><strong>tax_rate</strong> can be <code className="bg-blue-100 px-1 rounded">0</code> for non-taxable items.</p>
                      <p>Each row creates <strong>one draft invoice</strong>. Multi-line invoice grouping is planned for a future phase.</p>
                      <p><strong>CSV and Excel use the same columns.</strong> In Excel, dates can be date-formatted cells or <code className="bg-blue-100 px-1 rounded">YYYY-MM-DD</code> text. Numbers should be plain numeric cells.</p>
                      <p>Excel imports read the <strong>first sheet only</strong>. Merged cells are not supported.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Step 2: Parse ───────────────────────────────────────────── */}
        {step === "parse" && batch && (
          <div className="space-y-6 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-2xl bg-blue-100 p-4">
                <FileText className="h-10 w-10 text-blue-600" />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-700">File Uploaded Successfully</p>
                <p className="mt-1 text-sm text-slate-500">
                  {batch.file_name} · Batch: {batch.id.slice(0, 8)}...
                </p>
              </div>
            </div>
            <LoadingButton
              variant="primary"
              size="lg"
              isLoading={isLoading}
              loadingText="Parsing CSV..."
              onClick={() => parseBatch(batch.id)}
            >
              <Table2 className="h-4 w-4" />
              Parse CSV File
            </LoadingButton>
          </div>
        )}

        {/* ── Step 3: Preview ─────────────────────────────────────────── */}
        {step === "preview" && batch && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">Preview Parsed Rows</h2>
                <p className="text-sm text-slate-500">
                  {rows.length} rows extracted from {batch.file_name}
                </p>
              </div>
              <LoadingButton
                variant="primary"
                size="md"
                isLoading={isLoading}
                loadingText="Validating..."
                onClick={() => validateBatch(batch.id)}
              >
                <CheckCircle2 className="h-4 w-4" />
                Validate Rows
              </LoadingButton>
            </div>

            <RowsTable rows={rows} showValidation={false} />
          </div>
        )}

        {/* ── Step 4: Validate → Execute ──────────────────────────────── */}
        {step === "execute" && batch && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">Validation Complete</h2>
                <p className="text-sm text-slate-500">
                  Review results, then create draft invoices for valid rows.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <LoadingButton
                  variant="secondary"
                  size="md"
                  onClick={() => setStep("preview")}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </LoadingButton>
                <LoadingButton
                  variant="primary"
                  size="md"
                  isLoading={isLoading}
                  loadingText="Creating Drafts..."
                  disabled={batch.valid_rows === 0}
                  onClick={() => executeBatch(batch.id)}
                >
                  <Zap className="h-4 w-4" />
                  Create {batch.valid_rows} Draft Invoice{batch.valid_rows !== 1 ? "s" : ""}
                </LoadingButton>
              </div>
            </div>

            {/* Validation summary */}
            <div className="grid grid-cols-3 gap-3">
              <SummaryCard
                label="Valid Rows"
                value={batch.valid_rows}
                icon={<CheckCircle2 className="h-5 w-5 text-emerald-500" />}
                color="emerald"
              />
              <SummaryCard
                label="Error Rows"
                value={batch.error_rows}
                icon={<XCircle className="h-5 w-5 text-red-500" />}
                color="red"
              />
              <SummaryCard
                label="Total Rows"
                value={batch.total_rows}
                icon={<Table2 className="h-5 w-5 text-slate-500" />}
                color="slate"
              />
            </div>

            {batch.valid_rows === 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
                <XCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-red-800">No valid rows</p>
                  <p className="mt-0.5 text-sm text-red-700">
                    All rows have validation errors. Please fix the CSV and re-upload.
                  </p>
                </div>
              </div>
            )}

            <RowsTable rows={rows} showValidation={true} />
          </div>
        )}

        {/* ── Step 5/6: Result ────────────────────────────────────────── */}
        {step === "result" && batch && (
          <div className="space-y-6">
            {/* Result header */}
            <div className="text-center">
              <div className="inline-flex rounded-2xl bg-emerald-100 p-4 mb-4">
                <CheckCircle2 className="h-10 w-10 text-emerald-600" />
              </div>
              <h2 className="text-xl font-bold text-slate-800">Import Complete</h2>
              <p className="mt-1 text-sm text-slate-500">
                Draft invoices have been created. They can be reviewed and posted individually.
              </p>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <SummaryCard
                label="Drafts Created"
                value={batch.created_count}
                icon={<FileText className="h-5 w-5 text-blue-500" />}
                color="blue"
              />
              <SummaryCard
                label="Errors"
                value={batch.error_rows}
                icon={<XCircle className="h-5 w-5 text-red-500" />}
                color="red"
              />
              <SummaryCard
                label="Matched Customers"
                value={batch.matched_customers_count}
                icon={<CheckCircle2 className="h-5 w-5 text-emerald-500" />}
                color="emerald"
              />
              <SummaryCard
                label="Created Customers"
                value={batch.created_customers_count}
                icon={<CheckCircle2 className="h-5 w-5 text-blue-500" />}
                color="blue"
              />
              <SummaryCard
                label="Skipped"
                value={batch.skipped_count}
                icon={<AlertTriangle className="h-5 w-5 text-amber-500" />}
                color="amber"
              />
              <SummaryCard
                label="Posted"
                value={batch.posted_count}
                icon={<CheckCircle2 className="h-5 w-5 text-slate-400" />}
                color="slate"
                suffix="(always 0)"
              />
            </div>

            {/* Batch metadata */}
            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
              <MetaRow label="Batch ID" value={batch.id} mono />
              <MetaRow label="File" value={batch.file_name} />
              <MetaRow label="Status" value={batch.status} badge />
              <MetaRow label="Total Rows" value={String(batch.total_rows)} />
              <MetaRow label="Created At" value={formatDate(batch.created_at)} />
              {batch.completed_at && (
                <MetaRow label="Completed At" value={formatDate(batch.completed_at)} />
              )}
            </div>

            {/* Row details */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Row Details</h3>
              <RowsTable rows={rows} showValidation={true} showResult={true} />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-2">
              <LoadingButton variant="secondary" size="md" onClick={reset}>
                <RotateCcw className="h-4 w-4" />
                Import Another File
              </LoadingButton>
              <Link href="/invoices">
                <LoadingButton variant="primary" size="md">
                  <Eye className="h-4 w-4" />
                  View Invoices
                </LoadingButton>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  icon,
  color,
  suffix,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  suffix?: string;
}) {
  return (
    <div className={cn(
      "rounded-xl border p-4 flex items-center gap-3",
      `border-${color}-200 bg-${color}-50/50`
    )}>
      {icon}
      <div>
        <p className="text-2xl font-bold text-slate-800">{value}</p>
        <p className="text-xs text-slate-500">
          {label}
          {suffix && <span className="ml-1 text-slate-400">{suffix}</span>}
        </p>
      </div>
    </div>
  );
}

function MetaRow({
  label,
  value,
  mono,
  badge,
}: {
  label: string;
  value: string;
  mono?: boolean;
  badge?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-sm text-slate-500">{label}</span>
      {badge ? (
        <StatusBadge status={value} />
      ) : (
        <span className={cn("text-sm font-medium text-slate-800", mono && "font-mono text-xs")}>
          {value}
        </span>
      )}
    </div>
  );
}

function RowStatusBadge({ status }: { status: string }) {
  const config = ROW_STATUS_COLORS[status] ?? ROW_STATUS_COLORS.Pending;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
        config.bg,
        config.text
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", config.dot)} />
      {status}
    </span>
  );
}

function RowsTable({
  rows,
  showValidation,
  showResult,
}: {
  rows: ImportRow[];
  showValidation?: boolean;
  showResult?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 p-8 text-center">
        <Table2 className="h-8 w-8 text-slate-300 mx-auto mb-2" />
        <p className="text-sm text-slate-500">No rows to display</p>
      </div>
    );
  }

  // Get column keys from first row's raw_data
  const rawKeys = rows[0]?.raw_data ? Object.keys(rows[0].raw_data) : [];

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-12">
                #
              </th>
              {showValidation && (
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-24">
                  Status
                </th>
              )}
              {rawKeys.map((key) => (
                <th
                  key={key}
                  className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap"
                >
                  {key}
                </th>
              ))}
              {showValidation && (
                <>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Customer Action
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Customer Name
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Customer Code
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Invoice Reference
                  </th>
                </>
              )}
              {showValidation && (
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider min-w-[200px]">
                  Errors
                </th>
              )}
              {showResult && (
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Invoice ID
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const hasErrors = row.status === "Error" && row.validation_errors?.length;
              const resolution = row.mapped_data?.customer_resolution as ImportCustomerResolution | undefined;
              return (
                <tr
                  key={row.id}
                  className={cn(
                    "transition-colors",
                    hasErrors ? "bg-red-50/50" : "hover:bg-slate-50"
                  )}
                >
                  <td className="px-3 py-2 text-xs text-slate-400 font-mono">{row.row_number}</td>
                  {showValidation && (
                    <td className="px-3 py-2">
                      <RowStatusBadge status={row.status} />
                    </td>
                  )}
                  {rawKeys.map((key) => {
                    const val = row.raw_data?.[key];
                    const errorFields = row.validation_errors?.map((e) => e.field) ?? [];
                    const hasFieldError = errorFields.includes(key);
                    return (
                      <td
                        key={key}
                        className={cn(
                          "px-3 py-2 text-slate-700 whitespace-nowrap max-w-[200px] truncate",
                          hasFieldError && "text-red-700 font-medium"
                        )}
                        title={String(val ?? "")}
                      >
                        {hasFieldError && (
                          <AlertTriangle className="inline h-3 w-3 text-red-500 mr-1" />
                        )}
                        {val != null ? String(val) : "—"}
                      </td>
                    );
                  })}
                  {showValidation && (
                    <>
                      <td className="px-3 py-2 text-xs font-medium text-slate-700 whitespace-nowrap">
                        {resolution?.action ?? (hasErrors ? "Error" : "—")}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-700 whitespace-nowrap">
                        {resolution?.customer_name ?? String(row.raw_data?.customer_name || "—")}
                      </td>
                      <td className="px-3 py-2 text-xs font-mono text-slate-600 whitespace-nowrap">
                        {resolution?.customer_code ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-700 whitespace-nowrap">
                        {String(row.raw_data?.reference_no || "—")}
                      </td>
                    </>
                  )}
                  {showValidation && (
                    <td className="px-3 py-2">
                      {row.validation_errors?.length ? (
                        <div className="space-y-0.5">
                          {row.validation_errors.map((err, i) => (
                            <p key={i} className="text-xs text-red-600">
                              {err.field && (
                                <code className="font-mono bg-red-100 px-1 rounded mr-1">{err.field}</code>
                              )}
                              {err.message ?? err.error ?? "Validation error"}
                            </p>
                          ))}
                        </div>
                      ) : row.status === "Valid" ? (
                        <span className="text-xs text-emerald-600">✓ Valid</span>
                      ) : null}
                    </td>
                  )}
                  {showResult && (
                    <td className="px-3 py-2">
                      {row.invoice_id ? (
                        <Link
                          href={`/invoices/${row.invoice_id}`}
                          className="text-xs text-brand-600 hover:text-brand-700 font-mono"
                        >
                          {row.invoice_id.slice(0, 8)}...
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
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
