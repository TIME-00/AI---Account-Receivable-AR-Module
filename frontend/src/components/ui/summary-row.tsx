import { cn } from "@/lib/utils";

interface SummaryRowProps {
  label: string;
  value: string;
  highlight?: boolean;
}

export function SummaryRow({ label, value, highlight }: SummaryRowProps) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span
        className={cn(
          "font-medium",
          highlight ? "text-emerald-500" : "text-slate-700"
        )}
      >
        {value}
      </span>
    </div>
  );
}
