import { UploadZone, GenerateButton } from "./Upload";
import { RecentNotes } from "./Notes";
import { StatsSection } from "./Stats";

export function HomePage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* 欢迎标题 */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">
            <span className="gradient-text">VNote</span>
            <span className="text-slate-700 dark:text-slate-200"> 智能视频笔记</span>
          </h1>
          <p className="text-slate-500 dark:text-slate-400">
            上传视频和字幕，AI 自动生成结构化笔记
          </p>
        </div>

        {/* 上传区域 */}
        <div className="space-y-4">
          <UploadZone />

          <div className="flex items-center justify-center">
            <GenerateButton />
          </div>
        </div>

        {/* 最近笔记 */}
        <RecentNotes />

        {/* 统计数据 */}
        <StatsSection />
      </div>
    </div>
  );
}
