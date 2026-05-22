import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Check, ChevronDown, Database, FolderOpen, HardDrive, Loader2, RefreshCw, ShieldAlert, Trash2, Video } from "lucide-react";

import { ConfirmDialog } from "../common/ConfirmDialog";
import { message } from "../../utils/message";
import { useGlassBg } from "../../hooks/useGlassBg";
import type {
  CleanupPreview,
  CleanupRequest,
  CleanupResult,
  DataManagementOverview,
  DataManagementScanResult,
  Note,
} from "../../types";

interface DataManagementSectionProps {
  notes: Note[];
}

const riskToneMap: Record<string, string> = {
  low: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20",
  medium: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20",
  high: "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20",
};

const kindLabelMap: Record<string, string> = {
  missing_video: "源视频缺失",
  missing_subtitle: "源字幕缺失",
};

const integrityActionLabelMap: Record<string, string> = {
  db_orphans: "清理",
  fs_orphans: "清理",
  broken_assets: "修复",
};

const protectedCleanupCategoryKeys = new Set([
  "chapter_screenshots",
  "ai_note_screenshots",
  "assist_screenshots",
]);

export function DataManagementSection({ notes }: DataManagementSectionProps) {
  const glassCard = useGlassBg("card");
  const glassInput = useGlassBg("input");
  const glassMenu = useGlassBg("menu");
  const [selectedNoteId, setSelectedNoteId] = useState<string>("all");
  const [overview, setOverview] = useState<DataManagementOverview | null>(null);
  const [scanResult, setScanResult] = useState<DataManagementScanResult | null>(null);
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [previewingCategory, setPreviewingCategory] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<CleanupRequest | null>(null);
  const [showNoteDropdown, setShowNoteDropdown] = useState(false);
  const noteDropdownRef = useRef<HTMLDivElement>(null);

  const noteIds = useMemo(() => {
    if (selectedNoteId === "all") {
      return undefined;
    }
    return [selectedNoteId];
  }, [selectedNoteId]);

  const selectedNoteLabel = useMemo(() => {
    if (selectedNoteId === "all") {
      return "全部笔记";
    }
    return notes.find((note) => note.id === selectedNoteId)?.title ?? "当前笔记";
  }, [notes, selectedNoteId]);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const loadOverview = async () => {
    setLoading(true);
    try {
      const [overviewData, scanData] = await Promise.all([
        invoke<DataManagementOverview>("get_data_management_overview", { noteIds }),
        invoke<DataManagementScanResult>("scan_data_management", { noteIds }),
      ]);
      setOverview(overviewData);
      setScanResult(scanData);
    } catch (error) {
      console.error("Failed to load data management overview:", error);
      message.error(`数据管理加载失败：${String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, [selectedNoteId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (noteDropdownRef.current && !noteDropdownRef.current.contains(event.target as Node)) {
        setShowNoteDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleRefreshScan = async () => {
    setScanning(true);
    try {
      const scanData = await invoke<DataManagementScanResult>("scan_data_management", { noteIds });
      setScanResult(scanData);
      setOverview(scanData.overview);
      message.success("数据扫描已刷新");
    } catch (error) {
      console.error("Failed to scan data management:", error);
      message.error(`扫描失败：${String(error)}`);
    } finally {
      setScanning(false);
    }
  };

  const handlePreviewCleanup = async (key: string, mode: "category" | "integrity" = "category") => {
    setPreviewingCategory(key);
    try {
      const request: CleanupRequest = {
        categories: mode === "category" ? [key] : [],
        integrity_targets: mode === "integrity" ? [key] : null,
        note_ids: noteIds ?? null,
      };
      const result = await invoke<CleanupPreview>("preview_data_cleanup", { request });
      setPreview(result);
      setPendingRequest(request);
      setConfirmOpen(true);
    } catch (error) {
      console.error("Failed to preview cleanup:", error);
      message.error(`预览失败：${String(error)}`);
    } finally {
      setPreviewingCategory(null);
    }
  };

  const handleConfirmCleanup = async () => {
    if (!pendingRequest) return;
    setExecuting(true);
    setConfirmOpen(false);
    try {
      const result = await invoke<CleanupResult>("execute_data_cleanup", { request: pendingRequest });
      message.success(`处理完成，共处理 ${result.processed_items} 项，释放 ${formatBytes(result.cleared_bytes)}`);
      setPreview(null);
      setPendingRequest(null);
      await loadOverview();
    } catch (error) {
      console.error("Failed to execute cleanup:", error);
      message.error(`清理失败：${String(error)}`);
    } finally {
      setExecuting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-slate-600 dark:text-slate-400">
        <Loader2 size={18} className="animate-spin mr-2" />
        加载数据管理中...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className={`rounded-2xl border border-slate-200 dark:border-vnote-border p-4 md:p-5 space-y-4 ${glassCard}`}>
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-vnote-surface px-2.5 py-1">
              <Database size={12} />
              当前范围：{selectedNoteLabel}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 px-2.5 py-1">
              <ShieldAlert size={12} />
              {scanResult?.integrity_report.broken_assets_count ?? 0} 项异常资源
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-vnote-surface px-2.5 py-1">
              <Video size={12} />
              {scanResult?.source_health_report.missing_video_count ?? 0} 个缺失视频
            </span>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 lg:w-auto">
            <div className="relative" ref={noteDropdownRef}>
              <button
                type="button"
                onClick={() => setShowNoteDropdown((prev) => !prev)}
                className={`min-w-[220px] px-3 py-2 pr-10 rounded-xl border border-slate-200 dark:border-slate-600 text-sm text-slate-900 dark:text-slate-100 font-medium text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer hover:border-slate-300 dark:hover:border-slate-500 transition-all truncate ${glassInput}`}
              >
                {selectedNoteLabel}
              </button>
              <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none transition-transform ${showNoteDropdown ? "rotate-180" : ""}`} />
              {showNoteDropdown && (
                <div className={`absolute z-50 mt-2 w-full right-0 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 py-1 max-h-60 overflow-auto ${glassMenu}`}>
                  {[
                    { id: "all", title: "全部笔记" },
                    ...notes.map((note) => ({ id: note.id, title: note.title })),
                  ].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        setSelectedNoteId(option.id);
                        setShowNoteDropdown(false);
                      }}
                      className={`w-full px-4 py-2.5 text-left text-sm flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer ${
                        selectedNoteId === option.id ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20" : "text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <span className="truncate">{option.title}</span>
                      {selectedNoteId === option.id && <Check className="w-4 h-4 flex-shrink-0 ml-2" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={handleRefreshScan}
              disabled={scanning || executing}
              className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-vnote-border hover:bg-slate-100 dark:hover:bg-vnote-hover flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw size={14} className={scanning ? "animate-spin" : ""} />
              重新扫描
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <SummaryMetric
            icon={HardDrive}
            label="总占用"
            value={formatBytes(overview?.total_size_bytes ?? 0)}
          />
          <SummaryMetric
            icon={Trash2}
            label="可回收空间"
            value={formatBytes(overview?.reclaimable_bytes ?? 0)}
            accent="text-red-600 dark:text-red-400"
          />
          <SummaryMetric
            icon={FolderOpen}
            label="文件数"
            value={String(overview?.total_file_count ?? 0)}
          />
          <div className="rounded-xl border border-slate-200 dark:border-vnote-border bg-slate-50 dark:bg-vnote-surface px-4 py-3">
            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 text-sm mb-1.5">
              <Database size={14} />
              数据目录
            </div>
            <div className="text-sm text-slate-900 dark:text-slate-100 break-all leading-6">
              {overview?.data_root ?? "-"}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-vnote-border overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-vnote-border font-medium text-slate-900 dark:text-slate-100">
          分类清理
        </div>
        <div className="divide-y divide-slate-200 dark:divide-vnote-border">
          {(overview?.categories ?? []).map((category) => {
            const isProtectedCleanupCategory = protectedCleanupCategoryKeys.has(category.key);

            return (
              <div key={category.key} className="px-4 py-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{category.label}</div>
                  <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    {category.file_count} 项 · {formatBytes(category.size_bytes)}
                    {category.note_count !== null ? ` · ${category.note_count} 条笔记` : ""}
                  </div>
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-400 mr-2">
                  {formatBytes(category.reclaimable_bytes)}
                </div>
                <button
                  onClick={() => {
                    if (!isProtectedCleanupCategory) {
                      handlePreviewCleanup(category.key);
                    }
                  }}
                  disabled={isProtectedCleanupCategory || previewingCategory === category.key || executing || category.file_count === 0}
                  title={isProtectedCleanupCategory ? "该分类与真实笔记相关，已禁止清理" : undefined}
                  className="px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 cursor-pointer"
                >
                  {previewingCategory === category.key ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  {isProtectedCleanupCategory ? "已保护" : "清理"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-vnote-border p-4">
          <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100 font-medium mb-3">
            <ShieldAlert size={16} className="text-amber-500" />
            异常扫描
          </div>
          <div className="space-y-3 text-sm">
            <DiagnosticActionLine
              label="数据库孤儿"
              value={String(scanResult?.integrity_report.db_orphans_count ?? 0)}
              actionLabel={integrityActionLabelMap.db_orphans}
              onAction={() => handlePreviewCleanup("db_orphans", "integrity")}
              disabled={(scanResult?.integrity_report.db_orphans_count ?? 0) === 0 || executing || previewingCategory === "db_orphans"}
              loading={previewingCategory === "db_orphans"}
            />
            <DiagnosticActionLine
              label="文件孤儿"
              value={String(scanResult?.integrity_report.fs_orphans_count ?? 0)}
              actionLabel={integrityActionLabelMap.fs_orphans}
              onAction={() => handlePreviewCleanup("fs_orphans", "integrity")}
              disabled={(scanResult?.integrity_report.fs_orphans_count ?? 0) === 0 || executing || previewingCategory === "fs_orphans"}
              loading={previewingCategory === "fs_orphans"}
            />
            <DiagnosticActionLine
              label="失效资源"
              value={String(scanResult?.integrity_report.broken_assets_count ?? 0)}
              actionLabel={integrityActionLabelMap.broken_assets}
              onAction={() => handlePreviewCleanup("broken_assets", "integrity")}
              disabled={(scanResult?.integrity_report.broken_assets_count ?? 0) === 0 || executing || previewingCategory === "broken_assets"}
              loading={previewingCategory === "broken_assets"}
            />
            {(scanResult?.integrity_report.examples ?? []).slice(0, 4).map((item, index) => (
              <div key={`${item.path}-${index}`} className="rounded-lg bg-slate-50 dark:bg-vnote-surface px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
                <div className="font-medium">{item.detail}</div>
                <div className="truncate mt-1">{item.path}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-vnote-border p-4">
          <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100 font-medium mb-3">
            <Video size={16} className="text-red-500" />
            源文件健康检查
          </div>
          <div className="space-y-3 text-sm">
            <DiagnosticLine label="缺失视频" value={String(scanResult?.source_health_report.missing_video_count ?? 0)} />
            <DiagnosticLine label="缺失字幕" value={String(scanResult?.source_health_report.missing_subtitle_count ?? 0)} />
            {(scanResult?.source_health_report.issues ?? []).slice(0, 4).map((issue) => (
              <div key={`${issue.note_id}-${issue.kind}-${issue.path}`} className="rounded-lg bg-slate-50 dark:bg-vnote-surface px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
                <div className="font-medium flex items-center gap-2">
                  <AlertTriangle size={12} className="text-red-500" />
                  {issue.title} · {kindLabelMap[issue.kind] ?? issue.kind}
                </div>
                <div className="truncate mt-1">{issue.path}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="确认清理"
        message={preview
          ? `本次预计处理 ${preview.total_items} 项，其中 ${preview.total_files} 项涉及文件，释放 ${formatBytes(preview.total_bytes)}。是否继续？`
          : "确认执行清理吗？"}
        confirmText={executing ? "清理中..." : "确认清理"}
        onConfirm={handleConfirmCleanup}
        onCancel={() => {
          if (!executing) {
            setConfirmOpen(false);
            setPendingRequest(null);
          }
        }}
        danger
      />

      {preview && confirmOpen && (
        <div className="rounded-xl border border-slate-200 dark:border-vnote-border p-4 bg-slate-50 dark:bg-vnote-surface">
          <div className="font-medium text-slate-900 dark:text-slate-100 mb-3">清理预览</div>
          <div className="space-y-3">
            {preview.groups.map((group) => (
              <div key={group.key} className={`rounded-lg border border-slate-200 dark:border-vnote-border px-3 py-3 ${glassCard}`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{group.label}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                      {group.items_count} 项 · {formatBytes(group.reclaimable_bytes)}
                    </div>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs ${riskToneMap[group.risk_level] ?? riskToneMap.medium}`}>
                    {group.risk_level}
                  </span>
                </div>
                {group.sample_paths.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {group.sample_paths.slice(0, 3).map((path) => (
                      <div key={path} className="text-xs text-slate-600 dark:text-slate-400 truncate">{path}</div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryMetric({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof HardDrive;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-vnote-border bg-slate-50 dark:bg-vnote-surface px-4 py-3">
      <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 text-sm mb-1.5">
        <Icon size={14} />
        {label}
      </div>
      <div className={`text-lg font-semibold text-slate-900 dark:text-slate-100 ${accent ?? ""}`}>
        {value}
      </div>
    </div>
  );
}

function DiagnosticLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-slate-50 dark:bg-vnote-surface px-3 py-2">
      <span className="text-slate-600 dark:text-slate-300">{label}</span>
      <span className="font-medium text-slate-900 dark:text-slate-100">{value}</span>
    </div>
  );
}

function DiagnosticActionLine({
  label,
  value,
  actionLabel,
  onAction,
  disabled,
  loading,
}: {
  label: string;
  value: string;
  actionLabel: string;
  onAction: () => void;
  disabled: boolean;
  loading: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 dark:bg-vnote-surface px-3 py-2">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-slate-600 dark:text-slate-300">{label}</span>
        <span className="font-medium text-slate-900 dark:text-slate-100">{value}</span>
      </div>
      <button
        type="button"
        onClick={onAction}
        disabled={disabled}
        className="px-2.5 py-1 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 cursor-pointer"
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
        {actionLabel}
      </button>
    </div>
  );
}
