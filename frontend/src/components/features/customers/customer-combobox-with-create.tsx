"use client";

import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { isVisibleCustomer } from "@/lib/customer-visibility";
import {
  countryOptions,
  getCityOptions,
  getPostalOptions,
  getStateOptions,
} from "@/lib/address-options";
import {
  findSimilarVisibleCustomer,
  normalizeCustomerDisplayName,
  validateCustomerNameQuality,
} from "@/lib/customer-name-validation";
import {
  useInlineCustomerCreate,
  type InlineCustomerCreatePayload,
} from "@/hooks/use-inline-customer-create";
import type { Customer } from "@/types";

interface CustomerComboboxWithCreateProps {
  customers: Customer[];
  selectedName?: string;
  onSelect: (customer: Customer) => void;
  onClearSelection: () => void;
  onSearchChange?: (query: string) => void;
  error?: string;
  className?: string;
}

const emptyQuickCreate = (customerName: string): InlineCustomerCreatePayload => ({
  customer_name: normalizeCustomerDisplayName(customerName),
  customer_type: "Corporate",
  registration_no: "",
  bill_addr_line1: "",
  bill_city: "",
  bill_state: "",
  bill_postal: "",
  bill_country: "SG",
  contact_name: "",
  contact_phone: "",
  contact_email: "",
});

export function CustomerComboboxWithCreate({
  customers,
  selectedName = "",
  onSelect,
  onClearSelection,
  onSearchChange,
  error,
  className,
}: CustomerComboboxWithCreateProps) {
  const [query, setQuery] = useState("");
  const [chosenName, setChosenName] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [createError, setCreateError] = useState("");
  const [quickCreate, setQuickCreate] = useState(() => emptyQuickCreate(""));
  const createCustomer = useInlineCustomerCreate();
  const stateOptions = getStateOptions(quickCreate.bill_country);
  const cityOptions = getCityOptions(quickCreate.bill_country, quickCreate.bill_state);
  const postalOptions = getPostalOptions(
    quickCreate.bill_country,
    quickCreate.bill_state,
    quickCreate.bill_city
  );

  const visibleCustomers = useMemo(
    () => customers.filter(isVisibleCustomer),
    [customers]
  );
  const normalizedQuery = normalizeCustomerName(query);
  const queryNameCheck = useMemo(
    () => validateCustomerNameQuality(normalizedQuery),
    [normalizedQuery]
  );
  const filteredCustomers = useMemo(() => {
    const match = normalizedQuery.toLocaleLowerCase();
    if (!match) return visibleCustomers;
    return visibleCustomers.filter((customer) =>
      `${customer.customer_name} ${customer.customer_id}`.toLocaleLowerCase().includes(match)
    );
  }, [normalizedQuery, visibleCustomers]);
  const hasExactVisibleMatch = visibleCustomers.some(
    (customer) => normalizeCustomerName(customer.customer_name).toLocaleLowerCase() === normalizedQuery.toLocaleLowerCase()
  );
  const canCreate = normalizedQuery.length > 0 && !hasExactVisibleMatch && !queryNameCheck.blockingError;

  const quickNameCheck = useMemo(
    () => validateCustomerNameQuality(quickCreate.customer_name, {
      enforceBusinessName: true,
      registrationNo: quickCreate.registration_no,
    }),
    [quickCreate.customer_name, quickCreate.registration_no]
  );
  const similarVisibleCustomer = useMemo(
    () => findSimilarVisibleCustomer(quickCreate.customer_name, visibleCustomers),
    [quickCreate.customer_name, visibleCustomers]
  );

  const updateQuery = (value: string) => {
    setQuery(value);
    setChosenName("");
    setIsOpen(true);
    onClearSelection();
    onSearchChange?.(value);
  };

  const selectCustomer = (customer: Customer) => {
    onSelect(customer);
    setChosenName(customer.customer_name);
    setQuery("");
    setIsOpen(false);
  };

  const openQuickCreate = () => {
    setQuickCreate(emptyQuickCreate(normalizedQuery));
    setCreateError("");
    setIsModalOpen(true);
    setIsOpen(false);
  };

  const updateQuickCreate = (field: keyof InlineCustomerCreatePayload, value: string) => {
    setQuickCreate((current) => ({ ...current, [field]: value }));
  };

  const updateCountry = (value: string) => {
    setQuickCreate((current) => ({
      ...current,
      bill_country: value,
      bill_state: "",
      bill_city: "",
      bill_postal: "",
    }));
  };

  const updateState = (value: string) => {
    setQuickCreate((current) => ({
      ...current,
      bill_state: value,
      bill_city: "",
      bill_postal: "",
    }));
  };

  const updateCity = (value: string) => {
    setQuickCreate((current) => ({
      ...current,
      bill_city: value,
      bill_postal: "",
    }));
  };

  const submitQuickCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateError("");

    if (quickNameCheck.blockingError) {
      setCreateError(quickNameCheck.blockingError);
      return;
    }

    try {
      const result = await createCustomer.mutateAsync({
        ...quickCreate,
        customer_name: normalizeCustomerDisplayName(quickCreate.customer_name),
      });
      selectCustomer(result.customer);
      setIsModalOpen(false);
      toast.success(result.created ? "Customer created" : "Existing customer selected", {
        description: `${result.customer.customer_name} (${result.customer.customer_id})`,
      });
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : "Customer creation failed.");
    }
  };

  return (
    <div className={cn("md:col-span-2", className)}>
      <label className="mb-1.5 block text-xs font-medium text-slate-600">
        Customer <span className="text-red-400">*</span>
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={selectedName || chosenName || query}
          onChange={(event) => updateQuery(event.target.value)}
          onFocus={() => setIsOpen(true)}
          placeholder="Search or enter a new customer name..."
          className={cn(
            "input-premium w-full pl-9",
            error && "!border-red-500 !ring-red-500/30"
          )}
        />

        {isOpen && (
          <div className="absolute left-0 top-full z-50 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-surface shadow-xl">
            {filteredCustomers.map((customer) => (
              <button
                key={customer.id}
                type="button"
                onClick={() => selectCustomer(customer)}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors hover:bg-slate-50"
              >
                <span>
                  <span className="block font-medium text-slate-700">{customer.customer_name}</span>
                  <span className="block text-[11px] text-slate-500">
                    {customer.customer_id} · {customer.customer_type} · {customer.default_currency}
                  </span>
                </span>
                <span className="text-xs text-slate-500">{customer.credit_rating}</span>
              </button>
            ))}
            {filteredCustomers.length === 0 && !canCreate && (
              <p className="px-3 py-3 text-sm text-slate-500">No visible customers found.</p>
            )}
            {normalizedQuery && queryNameCheck.blockingError && (
              <p className="border-t border-slate-100 px-3 py-3 text-xs text-red-500">
                {queryNameCheck.blockingError}
              </p>
            )}
            {canCreate && (
              <button
                type="button"
                onClick={openQuickCreate}
                className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-3 text-left text-sm font-medium text-brand-600 transition-colors hover:bg-brand-50"
              >
                <Plus className="h-4 w-4" />
                Create new customer: &quot;{normalizedQuery}&quot;
              </button>
            )}
          </div>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}

      <Dialog.Root open={isModalOpen} onOpenChange={setIsModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="ds-overlay-enter fixed inset-0 z-[80] ds-scrim" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] max-h-[90vh] w-[min(680px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-lg border border-slate-200 bg-surface p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-base font-semibold text-slate-900">
                  Quick Create Customer
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-xs text-slate-500">
                  Enter the customer details to continue with this document. The customer code is generated automatically.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>

            <form onSubmit={submitQuickCreate} className="mt-5 space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <QuickField
                  label="Customer Name"
                  value={quickCreate.customer_name}
                  onChange={(value) => updateQuickCreate("customer_name", value)}
                  error={quickNameCheck.blockingError}
                  description={
                    <CustomerNameHints
                      suffixSuggestion={quickNameCheck.suffixSuggestion}
                      similarCustomer={similarVisibleCustomer}
                      onApplySuggestion={(value) => updateQuickCreate("customer_name", value)}
                      onSelectExisting={(customer) => {
                        selectCustomer(customer);
                        setIsModalOpen(false);
                      }}
                    />
                  }
                />
                <QuickField label="Registration No." value={quickCreate.registration_no} onChange={(value) => updateQuickCreate("registration_no", value)} placeholder="Corporate registration number" />
                <QuickField label="Billing Address" value={quickCreate.bill_addr_line1} onChange={(value) => updateQuickCreate("bill_addr_line1", value)} className="md:col-span-2" />
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-600">Country <span className="text-red-400">*</span></span>
                  <select value={quickCreate.bill_country} onChange={(event) => updateCountry(event.target.value)} className="input-premium w-full">
                    {countryOptions.map((country) => (
                      <option key={country.value} value={country.value}>{country.label}</option>
                    ))}
                  </select>
                </label>
                <AddressSelect
                  label="State / Region"
                  value={quickCreate.bill_state}
                  placeholder="Select state / region"
                  options={stateOptions}
                  onChange={updateState}
                />
                <AddressSelect
                  label="City / Area"
                  value={quickCreate.bill_city}
                  placeholder="Select city / area"
                  options={cityOptions}
                  onChange={updateCity}
                  disabled={!quickCreate.bill_state}
                />
                <AddressSelect
                  label="Postal Code"
                  value={quickCreate.bill_postal}
                  placeholder="Select postal code"
                  options={postalOptions}
                  onChange={(value) => updateQuickCreate("bill_postal", value)}
                  disabled={!quickCreate.bill_city}
                />
                <QuickField label="Contact Name" value={quickCreate.contact_name} onChange={(value) => updateQuickCreate("contact_name", value)} />
                <QuickField label="Contact Phone" value={quickCreate.contact_phone} onChange={(value) => updateQuickCreate("contact_phone", value)} placeholder="+65 6123 4567" />
                <QuickField label="Contact Email" value={quickCreate.contact_email} onChange={(value) => updateQuickCreate("contact_email", value)} type="email" className="md:col-span-2" />
              </div>

              {createError && <p className="text-xs text-red-500">{createError}</p>}
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <Dialog.Close asChild>
                  <button type="button" className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
                    Cancel
                  </button>
                </Dialog.Close>
                <button
                  type="submit"
                  disabled={createCustomer.isPending || Boolean(quickNameCheck.blockingError)}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent-fill px-3 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {createCustomer.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Create Customer
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function CustomerNameHints({
  suffixSuggestion,
  similarCustomer,
  onApplySuggestion,
  onSelectExisting,
}: {
  suffixSuggestion: string | null;
  similarCustomer: Customer | null;
  onApplySuggestion: (value: string) => void;
  onSelectExisting: (customer: Customer) => void;
}) {
  if (!suffixSuggestion && !similarCustomer) return null;

  return (
    <div className="space-y-2">
      {suffixSuggestion && (
        <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
          Did you mean{" "}
          <button
            type="button"
            onClick={() => onApplySuggestion(suffixSuggestion)}
            className="font-semibold underline decoration-amber-400 underline-offset-2"
          >
            {suffixSuggestion}
          </button>
          ?
        </p>
      )}
      {similarCustomer && (
        <p className="rounded border border-sky-200 bg-sky-50 px-2 py-1.5 text-[11px] text-sky-700">
          Similar visible customer found:{" "}
          <button
            type="button"
            onClick={() => onSelectExisting(similarCustomer)}
            className="font-semibold underline decoration-sky-400 underline-offset-2"
          >
            {similarCustomer.customer_name} ({similarCustomer.customer_id})
          </button>
        </p>
      )}
    </div>
  );
}

function AddressSelect({
  label,
  value,
  placeholder,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: string[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-600">
        {label} <span className="text-red-400">*</span>
      </span>
      <select
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="input-premium w-full disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function QuickField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  className,
  error,
  description,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  className?: string;
  error?: string | null;
  description?: React.ReactNode;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-xs font-medium text-slate-600">
        {label} <span className="text-red-400">*</span>
      </span>
      <input
        required
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={cn("input-premium w-full", error && "!border-red-500 !ring-red-500/30")}
      />
      {error && <span className="mt-1 block text-xs text-red-500">{error}</span>}
      {description && <div className="mt-1">{description}</div>}
    </label>
  );
}

function normalizeCustomerName(value: string): string {
  return normalizeCustomerDisplayName(value);
}
