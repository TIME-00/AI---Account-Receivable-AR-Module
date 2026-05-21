// ============================================================================
// TSH Synergy AR — useInvoiceForm Hook
// Encapsulates form state, step navigation, API error mapping,
// and submit handlers for the Invoice Creation Workbench.
// ============================================================================

"use client";

import { useState, useMemo } from "react";
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
import {
  useCustomers,
  useTaxCodes,
  usePaymentTerms,
  useCreateInvoice,
  usePostInvoice,
} from "@/hooks/use-invoices";
import { ApiError } from "@/hooks/use-api";

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

  // ─── Step State ──────────────────────────────────────────────────────
  const [currentStep, setCurrentStep] = useState(1);

  // ─── Customer Search State ───────────────────────────────────────────
  const [selectedCustomerName, setSelectedCustomerName] = useState("");
  const [selectedTermId, setSelectedTermId] = useState<string | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerList, setShowCustomerList] = useState(false);

  // ─── Server Field Errors ─────────────────────────────────────────────
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // ─── Form ────────────────────────────────────────────────────────────
  const form = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceFormSchema),
    defaultValues: defaultInvoiceValues(),
    mode: "onChange",
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "lines",
  });

  // ─── Data Queries ────────────────────────────────────────────────────
  const { data: customersData } = useCustomers(customerSearch);
  const { data: taxCodes = [] } = useTaxCodes();
  const { data: paymentTerms = [] } = usePaymentTerms();
  const customers = customersData?.customers ?? [];

  // ─── Calculator Engine ───────────────────────────────────────────────
  const calc = useInvoiceCalculator(form, taxCodes, paymentTerms, selectedTermId);

  // ─── Mutations ───────────────────────────────────────────────────────
  const createMutation = useCreateInvoice();
  const postMutation = usePostInvoice();

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
    if (currentStep === 2 && !canProceedStep2) {
      toast.error("Please add at least 1 valid line item.");
      return;
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

  const handleCreateDraft = async () => {
    setFieldErrors({});
    const valid = await form.trigger();
    if (!valid) return;

    const values = form.getValues();
    try {
      const result = await createMutation.mutateAsync(values);
      toast.success("Invoice Created", {
        description: `Draft ${result.invoice_no} has been saved.`,
      });
      router.push("/invoices");
    } catch (error) {
      handleApiError(error);
    }
  };

  const handleCreateAndPost = async () => {
    setFieldErrors({});
    const valid = await form.trigger();
    if (!valid) return;

    const values = form.getValues();
    try {
      const draft = await createMutation.mutateAsync(values);
      const posted = await postMutation.mutateAsync({ invoiceId: draft.id });
      toast.success("Invoice Posted", {
        description: `${posted.invoice_no} posted successfully.${posted.je_no ? ` JE: ${posted.je_no}` : ""}`,
      });
      router.push("/invoices");
    } catch (error) {
      handleApiError(error);
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
    showCustomerList,
    setShowCustomerList,

    // Calculator
    calc,

    // Submit
    handleCreateDraft,
    handleCreateAndPost,
    createMutation,
    postMutation,
  };
}
