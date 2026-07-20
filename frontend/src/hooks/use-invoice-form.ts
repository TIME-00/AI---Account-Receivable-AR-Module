// ============================================================================
// TSH Synergy AR — useInvoiceForm Hook
// Encapsulates form state, step navigation, API error mapping,
// and submit handlers for the Invoice Creation Workbench.
// ============================================================================

"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  invoiceFormSchema,
  defaultInvoiceValues,
  type InvoiceFormValues,
} from "@/lib/invoice-schema";
import { useInvoiceCalculator } from "@/hooks/use-invoice-calculator";
import { useSeedBaseCurrency } from "@/hooks/use-seed-base-currency";

/**
 * Read a react-hook-form field error message without an `any` cast.
 *
 * RHF field errors are a recursive union (FieldError | FieldErrors | arrays), so
 * the message lives either on the node itself or on its synthetic `root`.
 */
function readFieldErrorMessage(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const node = error as { message?: unknown; root?: { message?: unknown } };
  if (typeof node.message === "string" && node.message.length > 0) return node.message;
  if (typeof node.root?.message === "string" && node.root.message.length > 0) return node.root.message;
  return undefined;
}
import {
  useCustomers,
  useTaxCodes,
  usePaymentTerms,
  useCreateInvoice,
  usePostInvoice,
} from "@/hooks/use-invoices";
import { ApiError } from "@/hooks/use-api";

let invoiceSubmissionInFlight = false;

/**
 * useInvoiceForm — Full orchestration hook for the Invoice Creation Workbench.
 *
 * Returns:
 * - form (react-hook-form instance)
 * - fieldArray (fields, append, remove)
 * - step navigation (currentStep, goNext, goPrev)
 * - data queries (customers, taxCodes, paymentTerms)
 * - calculation engine (calc)
 * - customer search state
 * - submit handlers (handleCreateDraft, handleCreateAndPost)
 * - mutation loading states
 * - server field errors
 */
export function useInvoiceForm() {
  const router = useRouter();

  useEffect(() => {
    invoiceSubmissionInFlight = false;
    return () => {
      invoiceSubmissionInFlight = false;
    };
  }, []);

  // ─── Step State ──────────────────────────────────────────────────────
  const [currentStep, setCurrentStep] = useState(1);

  // ─── Customer Search State ───────────────────────────────────────────
  const [selectedCustomerName, setSelectedCustomerName] = useState("");
  const [selectedTermId, setSelectedTermId] = useState<string | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");

  // ─── Server Field Errors ─────────────────────────────────────────────
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const submissionLockRef = useRef(false);
  const [submittingAction, setSubmittingAction] = useState<"draft" | "post" | null>(null);

  // ─── Form ────────────────────────────────────────────────────────────
  const form = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceFormSchema),
    defaultValues: defaultInvoiceValues(),
    mode: "onChange",
  });

  // B9DD-RR-003: seed the currency from the authenticated company base once it
  // is known. The form default is "" — never a fabricated "MYR" — and a user's
  // own selection is never overwritten.
  const baseCurrencyState = useSeedBaseCurrency(
    useMemo(
      () => ({
        getCurrency: () => form.getValues("currency"),
        setCurrency: (currency: string) =>
          form.setValue("currency", currency, { shouldValidate: true, shouldDirty: false }),
      }),
      [form],
    ),
  );

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "lines",
  });

  // ─── Data Queries ────────────────────────────────────────────────────
  const { data: customers = [] } = useCustomers(customerSearch);
  const { data: taxCodes = [] } = useTaxCodes();
  const { data: paymentTerms = [] } = usePaymentTerms();

  // ─── Calculator Engine ───────────────────────────────────────────────
  const calc = useInvoiceCalculator(form, taxCodes, paymentTerms, selectedTermId);

  // ─── Mutations ───────────────────────────────────────────────────────
  const createMutation = useCreateInvoice();
  const postMutation = usePostInvoice();
  const isSubmitting = submittingAction !== null || createMutation.isPending || postMutation.isPending;

  const docType = form.watch("doc_type");

  // ─── Step Navigation ─────────────────────────────────────────────────

  const canProceedStep1 = useMemo(() => {
    const v = form.getValues();
    return v.customer_id.length > 0 && v.invoice_date.length > 0 && v.currency.length >= 3;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.watch("customer_id"), form.watch("invoice_date"), form.watch("currency")]);

  const canProceedStep2 = useMemo(() => {
    return calc.isValid && calc.totals.line_count > 0;
  }, [calc.isValid, calc.totals.line_count]);

  const goNext = () => {
    if (currentStep === 1 && !canProceedStep1) {
      toast.error("Please complete the invoice header.");
      return;
    }
    if (currentStep === 2) {
      if (!canProceedStep2) {
        toast.error("Please add at least 1 valid line item.");
        return;
      }
      // Validate all line item required fields (description, quantity, unit_price)
      // using Zod schema before advancing to Review step.
      const lines = form.getValues("lines");
      const invalidLines: string[] = [];
      lines.forEach((line, idx) => {
        if (!line.description || line.description.trim().length === 0) {
          invalidLines.push(`Line ${idx + 1}: Description is required.`);
          form.setError(`lines.${idx}.description`, {
            type: "manual",
            message: "Description is required.",
          });
        }
        if (!line.quantity || line.quantity <= 0) {
          invalidLines.push(`Line ${idx + 1}: Quantity must be > 0.`);
        }
        if (!line.unit_price || line.unit_price <= 0) {
          invalidLines.push(`Line ${idx + 1}: Unit price must be > 0.`);
        }
      });
      if (invalidLines.length > 0) {
        toast.error("Line item validation failed", {
          description: invalidLines[0],
        });
        return;
      }
    }
    setCurrentStep((s) => Math.min(s + 1, 3));
  };

  const goPrev = () => {
    setCurrentStep((s) => Math.max(s - 1, 1));
  };

  // ─── Error Handling ──────────────────────────────────────────────────

  const handleApiError = (error: unknown) => {
    if (error instanceof ApiError) {
      const newFieldErrors: Record<string, string> = {};
      const details = error.details;

      if (error.code === "BR-CM-001" || error.code === "BR-CM-003") {
        newFieldErrors["customer_id"] = error.message;
        setCurrentStep(1);
      } else if (error.code === "BR-CUS-001" || error.code === "BR-CUS-002") {
        newFieldErrors["customer_id"] = error.message;
        setCurrentStep(1);
      } else if (error.code === "BR-INV-002") {
        if (details?.failures && Array.isArray(details.failures)) {
          (details.failures as string[]).forEach((msg, idx) => {
            newFieldErrors[`line_${idx}`] = msg;
          });
          setCurrentStep(2);
        } else {
          newFieldErrors["_form"] = error.message;
        }
      } else if (error.code === "BR-JE-007") {
        newFieldErrors["invoice_date"] = error.message;
        setCurrentStep(1);
      } else if (error.code === "VALIDATION_ERROR" && details?.field) {
        newFieldErrors[String(details.field)] = error.message;
        if (["customer_id", "invoice_date", "currency"].includes(String(details.field))) {
          setCurrentStep(1);
        } else {
          setCurrentStep(2);
        }
      }

      setFieldErrors(newFieldErrors);
    }
  };

  // ─── Submit Handlers ─────────────────────────────────────────────────

  const beginSubmission = (action: "draft" | "post") => {
    if (invoiceSubmissionInFlight || submissionLockRef.current || createMutation.isPending || postMutation.isPending) {
      return false;
    }
    invoiceSubmissionInFlight = true;
    submissionLockRef.current = true;
    setSubmittingAction(action);
    return true;
  };

  const endSubmission = () => {
    invoiceSubmissionInFlight = false;
    submissionLockRef.current = false;
    setSubmittingAction(null);
  };

  const handleCreateDraft = async () => {
    if (!beginSubmission("draft")) {
      return;
    }

    let shouldUnlock = true;
    try {
      setFieldErrors({});
      const valid = await form.trigger();
      if (!valid) {
        // Surface the first validation error as a toast
        const errors = form.formState.errors;
        const firstError = Object.values(errors).find(Boolean);
        const message = readFieldErrorMessage(firstError)
          ?? "Please fix form validation errors before saving.";
        toast.error("Validation Error", { description: String(message) });
        return;
      }

      const values = form.getValues();
      const result = await createMutation.mutateAsync(values);
      toast.success("Invoice Created", {
        description: `Draft ${result.invoice_no} has been saved.`,
      });
      shouldUnlock = false;
      router.push("/invoices");
    } catch (error) {
      handleApiError(error);
    } finally {
      if (shouldUnlock) endSubmission();
    }
  };

  const handleCreateAndPost = async () => {
    if (!beginSubmission("post")) {
      return;
    }

    let shouldUnlock = true;
    try {
      setFieldErrors({});
      const valid = await form.trigger();
      if (!valid) {
        const errors = form.formState.errors;
        const firstError = Object.values(errors).find(Boolean);
        const message = readFieldErrorMessage(firstError)
          ?? "Please fix form validation errors before posting.";
        toast.error("Validation Error", { description: String(message) });
        return;
      }

      const values = form.getValues();
      const draft = await createMutation.mutateAsync(values);
      const posted = await postMutation.mutateAsync({ invoiceId: draft.id });
      toast.success("Invoice Posted", {
        description: `${posted.invoice_no} posted successfully.${posted.je_no ? ` JE: ${posted.je_no}` : ""}`,
      });
      shouldUnlock = false;
      router.push("/invoices");
    } catch (error) {
      handleApiError(error);
    } finally {
      if (shouldUnlock) endSubmission();
    }
  };

  // ─── Return ──────────────────────────────────────────────────────────

  return {
    // Form
    form,
    fields,
    append,
    remove,
    docType,
    fieldErrors,

    // Step navigation
    currentStep,
    goNext,
    goPrev,

    // Data
    customers,
    taxCodes,
    paymentTerms,
    customerSearch,
    setCustomerSearch,

    // Customer selection
    selectedCustomerName,
    setSelectedCustomerName,
    selectedTermId,
    setSelectedTermId,

    // Calculator
    calc,

    // Company base currency (B9DD-RR-003) — authoritative, may be unavailable.
    baseCurrency: baseCurrencyState.baseCurrency,
    baseCurrencyLoading: baseCurrencyState.isLoading,
    baseCurrencyUnavailable: baseCurrencyState.isUnavailable,

    // Submit
    handleCreateDraft,
    handleCreateAndPost,
    isSubmitting,
    submittingAction,
    createMutation,
    postMutation,
  };
}
