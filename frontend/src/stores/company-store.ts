import { create } from "zustand";
import { persist } from "zustand/middleware";

interface CompanyStore {
  /** Currently selected company UUID */
  companyId: string;
  /** Company display name */
  companyName: string;
  /** Base currency (e.g. "MYR") */
  baseCurrency: string;
  /** Available companies for the switcher */
  companies: Array<{ id: string; name: string; code: string; currency: string }>;
  /** Set the active company */
  setCompany: (id: string, name: string, currency?: string) => void;
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
      baseCurrency: "MYR",
      companies: [],

      setCompany: (id, name, currency = "MYR") =>
        set({ companyId: id, companyName: name, baseCurrency: currency }),

      setCompanies: (companies) => set({ companies }),
    }),
    {
      name: "tsh-company-store",
    }
  )
);
