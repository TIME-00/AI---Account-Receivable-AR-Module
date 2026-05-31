import type { Customer } from "@/types";

type CustomerLinkedRecord = {
  customer_id: string;
};

export function isVisibleCustomer(customer: Customer): boolean {
  return customer.is_hidden !== true;
}

export function filterVisibleCustomers(customers: Customer[]): Customer[] {
  return customers.filter(isVisibleCustomer);
}

export function isKnownHiddenCustomer(customers: Customer[], customerId: string): boolean {
  return customers.some((customer) => customer.id === customerId && customer.is_hidden === true);
}

export function filterVisibleCustomerRecords<T extends CustomerLinkedRecord>(
  records: T[],
  customers: Customer[],
): T[] {
  const hiddenCustomerIds = new Set(
    customers.filter((customer) => customer.is_hidden === true).map((customer) => customer.id),
  );
  return records.filter((record) => !hiddenCustomerIds.has(record.customer_id));
}
