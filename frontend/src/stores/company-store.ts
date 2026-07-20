import { create } from "zustand";
import { persist } from "zustand/middleware";

interface CompanyStore {
  /** Currently selected company UUID */
  companyId: string;
  /** Company display name */
  companyName: string;
  /**
   * Base currency of the selected company, or null when not yet known.
   *
   * Batch 9D-D (B9DD-FEIR-006): this store must NOT fabricate a base currency
   * before authoritative company data is available. The authoritative source is
   * `GET /auth/me` → `company.base_currency` (see `useBaseCurrency`); this field
   * only mirrors the company-switcher selection and stays `null` until a real
   * currency is supplied. Consumers must render an explicit unavailable state
   * rather than assuming a default.
   */
  baseCurrency: string | null;
  /** Available companies for the switcher */
  companies: Array<{ id: string; name: string; code: string; currency: string }>;
  /** Set the active company */
  setCompany: (id: string, name: string, currency?: string | null) => void;
  /** Set the full list of available companies */
  setCompanies: (companies: Array<{ id: string; name: string; code: string; currency: string }>) => void;
}

/**
 * Global company context store (Zustand with localStorage persistence).
 * Used by useApi hook to inject X-Company-Id header.
 */
export const useCompanyStore = create<CompanyStore>()(
  persist(
    (set) => ({
      // Default placeholder — user should configure via .env or company switcher
      companyId: process.env.NEXT_PUBLIC_DEFAULT_COMPANY_ID ?? "",
      companyName: "TSH Synergy Sdn Bhd",
      // No fabricated base currency: authoritative value comes from /auth/me.
      baseCurrency: null,
      companies: [],

      setCompany: (id, name, currency = null) =>
        set({ companyId: id, companyName: name, baseCurrency: currency ?? null }),

      setCompanies: (companies) => set({ companies }),
    }),
    {
      name: "tsh-company-store",
      version: 2,
      // A previously-persisted store may still hold a fabricated "MYR" from the
      // pre-9D-D default. Drop the persisted base currency so it is re-derived
      // from authoritative company context rather than trusted from cache.
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Partial<CompanyStore>;
        return { ...state, baseCurrency: null } as CompanyStore;
      },
    }
  )
);
