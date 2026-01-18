import { FileText, Clock, TrendingUp, Activity } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { StatCard } from "./StatCard";

function formatWatchTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes} 分钟`;
}

function formatLastActivity(date: Date | null): string {
  if (!date) return "-";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  if (diffDays < 7) return `${diffDays} 天前`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} 周前`;
  return `${Math.floor(diffDays / 30)} 月前`;
}

export function StatsSection() {
  const { stats } = useApp();

  return (
    <section className="animate-fade-in">
      <h2 className="text-lg font-semibold text-slate-700 dark:text-slate-200 mb-4">数据统计</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<FileText className="w-6 h-6" />}
          label="笔记总数"
          value={stats.totalNotes}
          subValue="条笔记"
          color="blue"
        />

        <StatCard
          icon={<Clock className="w-6 h-6" />}
          label="累计学习"
          value={formatWatchTime(stats.totalWatchTime)}
          subValue="视频时长"
          color="green"
        />

        <StatCard
          icon={<TrendingUp className="w-6 h-6" />}
          label="本周新增"
          value={stats.notesThisWeek}
          subValue="条笔记"
          color="purple"
        />

        <StatCard
          icon={<Activity className="w-6 h-6" />}
          label="最近活跃"
          value={formatLastActivity(stats.lastActivityDate)}
          subValue="上次学习"
          color="orange"
        />
      </div>
    </section>
  );
}
