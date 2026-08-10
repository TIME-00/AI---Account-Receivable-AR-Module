"use client";

// ============================================================================
// Gate E — accessible dialog primitive.
//
// Built on the repository's Radix Dialog so every Gate E dialog gets, for free
// and consistently: a focus trap, initial focus, Escape-to-close, focus
// restoration to the trigger, `aria-modal`, a labelled title, and described
// content. Custom <div> dialogs are intentionally NOT used.
// ============================================================================

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";

export interface AutomationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /**
   * REQUIRED programmatic description. Radix links it to the dialog via
   * `aria-describedby` automatically, so every Gate E dialog is genuinely
   * described for assistive technology. It must meaningfully explain what will
   * change, any financial/provider impact, and what confirmation is required.
   * We never emit an empty `aria-describedby` or point it at a missing element.
   */
  description: string;
  /**
   * When the body already conveys the description visibly, set this so the
   * description element still EXISTS (and stays linked) but is only exposed to
   * screen readers rather than duplicated on screen.
   */
  visuallyHiddenDescription?: boolean;
  children: React.ReactNode;
  /** Footer actions (buttons). */
  footer?: React.ReactNode;
  /** Render as an alert dialog affordance (still a Radix Dialog). */
  tone?: "default" | "danger";
  /** Dialog width. Defaults to the compact `md`; recovery flows use `xl`. */
  size?: "md" | "lg" | "xl";
}

const SIZE_CLASS: Record<NonNullable<AutomationDialogProps["size"]>, string> = {
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
};

export function AutomationDialog({
  open,
  onOpenChange,
  title,
  description,
  visuallyHiddenDescription = false,
  children,
  footer,
  size = "md",
}: AutomationDialogProps) {
  // This is a CONTROLLED dialog (opened by a state change, not a Radix
  // `Dialog.Trigger`), so Radix has no opener to restore focus to on close.
  // We capture the element that had focus when the dialog opened and restore
  // focus to it in `onCloseAutoFocus`, giving real focus restoration (verified
  // in the Chromium E2E, which jsdom cannot reliably prove).
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      const active = document.activeElement;
      openerRef.current = active instanceof HTMLElement ? active : null;
    }
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className={`fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] ${SIZE_CLASS[size]} -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl focus:outline-none`}
          onCloseAutoFocus={(event) => {
            const opener = openerRef.current;
            if (opener && document.contains(opener) && typeof opener.focus === "function") {
              event.preventDefault();
              opener.focus();
            }
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="text-sm font-semibold text-slate-900">
              {title}
            </Dialog.Title>
            <Dialog.Close
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-400"
              aria-label="Close dialog"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Dialog.Close>
          </div>
          {/* Always rendered and always linked by Radix. Visually hidden only
              when the body copy would otherwise duplicate it. */}
          <Dialog.Description
            className={
              visuallyHiddenDescription
                ? "sr-only"
                : "mt-1 text-xs text-slate-500"
            }
          >
            {description}
          </Dialog.Description>
          <div className="mt-3 space-y-3 text-sm text-slate-700">{children}</div>
          {footer && (
            <div className="mt-5 flex justify-end gap-2">{footer}</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
