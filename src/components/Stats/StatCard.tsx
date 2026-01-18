import type { ReactNode } from "react";
import { cn } from "../../utils/cn";

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: string | number;
  subValue?: string;
  trend?: "up" | "down" | "neutral";
  color?: "blue" | "green" | "purple" | "orange";
}

const colorClasses = {
  blue: "from-blue-500/20 to-blue-600/10 text-blue-400",
  green: "from-green-500/20 to-green-600/10 text-green-400",
  purple: "from-purple-500/20 to-purple-600/10 text-purple-400",
  orange: "from-orange-500/20 to-orange-600/10 text-orange-400",
};

export function StatCard({
  icon,
  label,
  value,
  subValue,
  color = "blue",
}: StatCardProps) {
  return (
    <div
      className={cn(
        "relative p-5 rounded-xl overflow-hidden",
        "bg-white/90 dark:bg-vnote-card/90 border border-slate-200/60 dark:border-vnote-border/60",
        "backdrop-blur-xl shadow-sm",
        "hover:border-slate-300 dark:hover:border-vnote-muted hover:shadow-lg transition-all duration-300 hover:scale-[1.02]"
      )}
    >
      {/* 背景渐变 */}
      <div
        className={cn(
          "absolute inset-0 bg-gradient-to-br opacity-50",
          colorClasses[color]
        )}
      />

      <div className="relative flex items-start gap-4">
        {/* 图标 */}
        <div
          className={cn(
            "w-12 h-12 rounded-xl flex items-center justify-center",
            "bg-gradient-to-br",
            colorClasses[color]
          )}
        >
          {icon}
        </div>

        {/* 内容 */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-500 mb-1">{label}</p>
          <p className="text-2xl font-bold text-slate-700 dark:text-slate-100">{value}</p>
          {subValue && (
            <p className="text-xs text-slate-500 mt-1">{subValue}</p>
          )}
        </div>
      </div>
    </div>
  );
}
