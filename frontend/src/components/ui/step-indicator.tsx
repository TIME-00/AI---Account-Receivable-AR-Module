"use client";

import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { Check } from "lucide-react";

export interface StepConfig {
  id: number;
  label: string;
  icon: LucideIcon;
  desc: string;
}

interface StepIndicatorProps {
  steps: StepConfig[];
  currentStep: number;
}

export function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
  return (
    <div className="flex items-center gap-2">
      {steps.map((step, idx) => {
        const isActive = currentStep === step.id;
        const isComplete = currentStep > step.id;

        return (
          <div key={step.id} className="flex items-center">
            {idx > 0 && (
              <div
                className={cn(
                  "mx-2 h-[2px] w-8 transition-colors md:w-12",
                  isComplete ? "bg-brand-500" : "bg-slate-100"
                )}
              />
            )}
            <div className="flex items-center gap-2.5">
              <div
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition-all",
                  isActive
                    ? "bg-brand-600 text-white shadow-lg shadow-brand-900/40"
                    : isComplete
                    ? "bg-brand-600/20 text-brand-500"
                    : "bg-slate-200 text-slate-500"
                )}
              >
                {isComplete ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <step.icon className="h-4 w-4" />
                )}
              </div>
              <div className="hidden md:block">
                <p
                  className={cn(
                    "text-sm font-medium",
                    isActive ? "text-slate-900" : "text-slate-500"
                  )}
                >
                  {step.label}
                </p>
                <p className="text-[10px] text-slate-400">{step.desc}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
