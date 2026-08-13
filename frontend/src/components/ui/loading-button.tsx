"use client";

import { cn } from "@/lib/utils";
import { COMPOSABLE_FOCUS_RING } from "@/lib/focus-styles";
import { Loader2 } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from "react";

interface LoadingButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  isLoading?: boolean;
  loadingText?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
}

const variantStyles = {
  primary:
    "bg-accent-fill text-white hover:bg-accent-fill-hover active:bg-accent-fill-active shadow-md shadow-brand-200/50",
  secondary:
    "bg-surface text-slate-700 hover:bg-slate-50 active:bg-slate-100 border border-slate-300 shadow-sm",
  // Same dual-role trap as `primary`: a filled `red-600` resolves to a pale
  // red under the reversed dark ramp, leaving white text on a light pink
  // surface. `--danger-fill` is the surface-safe variant.
  danger:
    "bg-feedback-danger-fill text-white hover:bg-feedback-danger-fill-hover active:bg-feedback-danger-fill-active shadow-md shadow-red-200/50",
  ghost:
    "bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-800",
};

const sizeStyles = {
  sm: "h-8 px-3 text-xs rounded-md gap-1.5",
  md: "h-9 px-4 text-sm rounded-lg gap-2",
  lg: "h-11 px-6 text-sm rounded-lg gap-2",
};

export const LoadingButton = forwardRef<HTMLButtonElement, LoadingButtonProps>(
  (
    {
      children,
      isLoading = false,
      loadingText,
      variant = "primary",
      size = "md",
      disabled,
      className,
      onClick,
      ...props
    },
    ref
  ) => {
    const isDisabled = isLoading || disabled;
    const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
      if (isDisabled) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      onClick?.(event);
    };

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        onClick={handleClick}
        className={cn(
          "inline-flex items-center justify-center font-medium transition-all duration-200",
          "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
          COMPOSABLE_FOCUS_RING,
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        {...props}
      >
        {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
        {isLoading ? (loadingText ?? children) : children}
      </button>
    );
  }
);

LoadingButton.displayName = "LoadingButton";
