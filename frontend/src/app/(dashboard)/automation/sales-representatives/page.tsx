"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, UserRound } from "lucide-react";
import { useUserRole } from "@/hooks/use-user-role";
import {
  useCreateSalesRepresentative,
  useSalesRepresentatives,
  useUpdateSalesRepresentative,
} from "@/hooks/use-automation";
import { AutomationBadge } from "@/components/features/automation/automation-badge";
import { Pagination } from "@/components/features/automation/collection";
import {
  AutomationEmpty,
  AutomationError,
  AutomationLoading,
} from "@/components/features/automation/states";
import { switchStatusLabel } from "@/lib/automation/labels";
import { ApiError } from "@/hooks/use-api";
import {
  EMAIL_PATTERN,
  PHONE_PATTERN,
  type SalesRepresentative,
} from "@/lib/automation/contract";

/** Roles allowed to create/edit sales representatives (per gate-e.1 contract). */
const EDIT_ROLES = ["AR Supervisor", "Finance Manager"];

interface FormState {
  name: string;
  email: string;
  phone: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = { name: "", email: "", phone: "", is_active: true };

type Editor =
  | { mode: "create" }
  | { mode: "edit"; id: string }
  | null;

function validate(form: FormState): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = form.name.trim();
  if (name.length < 1 || name.length > 200) {
    errors.name = "Name is required (1–200 characters).";
  }
  const email = form.email.trim();
  if (email && (!EMAIL_PATTERN.test(email) || email !== email.toLowerCase())) {
    errors.email = "Enter a valid lowercase email address.";
  }
  const phone = form.phone.trim();
  if (phone && !PHONE_PATTERN.test(phone)) {
    errors.phone = "Use international format, e.g. +60123456789.";
  }
  if (form.is_active && !email) {
    errors.email = "An active representative must have an email address.";
  }
  return errors;
}

export default function SalesRepresentativesPage() {
  const { roles } = useUserRole();
  const canEdit = roles.some((r) => EDIT_ROLES.includes(r));

  const [page, setPage] = useState(1);
  const { data, isLoading, isError, isFetching, refetch } = useSalesRepresentatives({
    page,
    page_size: 25,
  });
  const create = useCreateSalesRepresentative();
  const update = useUpdateSalesRepresentative();

  const [editor, setEditor] = useState<Editor>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function openCreate() {
    setEditor({ mode: "create" });
    setForm(EMPTY_FORM);
    setErrors({});
  }

  function openEdit(rep: SalesRepresentative) {
    setEditor({ mode: "edit", id: rep.id });
    setForm({
      name: rep.name,
      email: rep.email ?? "",
      phone: rep.phone ?? "",
      is_active: rep.is_active,
    });
    setErrors({});
  }

  function closeEditor() {
    setEditor(null);
    setForm(EMPTY_FORM);
    setErrors({});
  }

  function submit() {
    if (!editor) return;
    const validation = validate(form);
    setErrors(validation);
    if (Object.keys(validation).length > 0) return;

    const payload = {
      name: form.name.trim(),
      email: form.email.trim() ? form.email.trim() : null,
      phone: form.phone.trim() ? form.phone.trim() : null,
      is_active: form.is_active,
    };

    if (editor.mode === "create") {
      create.mutate(payload, {
        onSuccess: () => {
          toast.success("Sales representative created.");
          closeEditor();
        },
        onError: (error) =>
          // Server validation: keep the user's entered values.
          toast.error(
            error instanceof ApiError ? error.message : "Could not create representative.",
          ),
      });
    } else {
      update.mutate(
        { id: editor.id, patch: payload },
        {
          onSuccess: () => {
            toast.success("Sales representative updated.");
            closeEditor();
          },
          onError: (error) =>
            toast.error(
              error instanceof ApiError ? error.message : "Could not update representative.",
            ),
        },
      );
    }
  }

  function toggleActive(rep: SalesRepresentative) {
    update.mutate(
      { id: rep.id, patch: { is_active: !rep.is_active } },
      {
        onSuccess: () =>
          toast.success(rep.is_active ? "Representative deactivated." : "Representative activated."),
        onError: (error) =>
          toast.error(error instanceof ApiError ? error.message : "Update failed."),
      },
    );
  }

  const saving = create.isPending || update.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Sales Representatives</h2>
          <p className="text-xs text-slate-500">
            Tenant business contacts for reminder recipients. They do not log in
            and have no financial role.
          </p>
        </div>
        {canEdit && !editor && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent-fill px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent-fill-hover"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add Representative
          </button>
        )}
      </div>

      {editor && canEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="grid gap-3 rounded-xl border border-slate-200 bg-surface p-4 sm:grid-cols-2"
          aria-label={
            editor.mode === "create"
              ? "Create sales representative"
              : "Edit sales representative"
          }
        >
          <p className="col-span-full text-xs font-semibold text-slate-700">
            {editor.mode === "create" ? "New representative" : "Edit representative"}
          </p>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-slate-700">Name</span>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              aria-invalid={Boolean(errors.name)}
            />
            {errors.name && <span className="text-red-600">{errors.name}</span>}
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-slate-700">Email</span>
            <input
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              aria-invalid={Boolean(errors.email)}
              inputMode="email"
            />
            {errors.email && <span className="text-red-600">{errors.email}</span>}
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-slate-700">Phone (international)</span>
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+60123456789"
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              aria-invalid={Boolean(errors.phone)}
              inputMode="tel"
            />
            {errors.phone && <span className="text-red-600">{errors.phone}</span>}
          </label>
          <label className="flex items-center gap-2 self-end text-xs">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            />
            <span className="font-medium text-slate-700">Active</span>
          </label>
          <div className="col-span-full flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-accent-fill px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Saving…" : editor.mode === "create" ? "Save" : "Update"}
            </button>
            <button
              type="button"
              onClick={closeEditor}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <AutomationLoading label="Loading representatives" />
      ) : isError || !data ? (
        <AutomationError onRetry={() => refetch()} />
      ) : data.rows.length === 0 ? (
        <AutomationEmpty
          title="No sales representatives yet"
          description="Add a representative to receive invoice due reminders for their assigned customers."
        />
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-surface">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Phone</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  {canEdit && <th className="px-4 py-2 font-medium">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((rep) => {
                  const status = switchStatusLabel(rep.is_active);
                  return (
                    <tr key={rep.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2 font-medium text-slate-800">
                        <span className="flex items-center gap-2">
                          <UserRound className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                          {rep.name}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-600">{rep.email ?? "—"}</td>
                      <td className="px-4 py-2 text-slate-600">{rep.phone ?? "—"}</td>
                      <td className="px-4 py-2">
                        <AutomationBadge
                          label={rep.is_active ? "Active" : "Inactive"}
                          tone={status.tone}
                        />
                      </td>
                      {canEdit && (
                        <td className="px-4 py-2">
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => openEdit(rep)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
                            >
                              <Pencil className="h-3 w-3" aria-hidden="true" /> Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleActive(rep)}
                              disabled={update.isPending}
                              className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-60"
                            >
                              {rep.is_active ? "Deactivate" : "Activate"}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination meta={data.meta} page={page} onPage={setPage} isFetching={isFetching} />
        </div>
      )}
    </div>
  );
}
