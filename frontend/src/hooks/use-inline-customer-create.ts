"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type { Customer, CustomerType } from "@/types";

export interface InlineCustomerCreatePayload {
  customer_name: string;
  customer_type: CustomerType;
  registration_no: string;
  bill_addr_line1: string;
  bill_city: string;
  bill_state: string;
  bill_postal: string;
  bill_country: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
}

interface InlineCustomerCreateResult {
  customer: Customer;
  created: boolean;
}

export function useInlineCustomerCreate() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: InlineCustomerCreatePayload) =>
      api.post<InlineCustomerCreateResult>("/customers/inline", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });
}
