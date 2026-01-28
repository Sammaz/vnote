import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, FolderPlus, ListPlus, Image } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { cn } from "../../utils/cn";
import { useApp } from "../../context/AppContext";
import type { Collection } from "../../types";

// 获取合集的所有子孙合集ID
function getDescendantIds(collections: Collection[], parentId: string): Set<string> {
  const descendants = new Set<string>();
  const queue = [parentId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    for (const c of collections) {
      if (c.parent_id === currentId && !descendants.has(c.id)) {
        descendants.add(c.id);
        queue.push(c.id);
      }
    }
  }

  return descendants;
}

interface CreateCollectionModalProps {
  onClose: () => void;
  editingCollection?: Collection | null;
  defaultParentId?: string;
}

export function CreateCollectionModal({
  onClose,
  editingCollection,
  defaultParentId,
}: CreateCollectionModalProps) {
  const { collections, createCollection, updateCollection } = useApp();
  const [mode, setMode] = useState<"create" | "addTo">("create");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [parentCollectionId, setParentCollectionId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!editingCollection;

  // 初始化编辑数据
  useEffect(() => {
    if (editingCollection) {
      setName(editingCollection.name);
      setDescription(editingCollection.description || "");
      setCoverImage(editingCollection.cover_image || null);
      setParentCollectionId(editingCollection.parent_id);
    }
  }, [editingCollection]);

  // 编辑模式下可选的父合集列表（排除自己和所有子孙合集）
  const availableParentCollections = useMemo(() => {
    if (!isEditing || !editingCollection) {
      return collections;
    }
    const descendantIds = getDescendantIds(collections, editingCollection.id);
    return collections.filter(
      (c) => c.id !== editingCollection.id && !descendantIds.has(c.id)
    );
  }, [collections, isEditing, editingCollection]);

  const handleSelectCover = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
      });
      if (selected) {
        setCoverImage(selected as string);
      }
    } catch (err) {
      console.error("Failed to select cover image:", err);
    }
  };

  const handleRemoveCover = () => {
    setCoverImage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError("请输入合集名称");
      return;
    }

    if (mode === "addTo" && !parentCollectionId) {
      setError("请选择父级合集");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      if (isEditing && editingCollection) {
        await updateCollection({
          ...editingCollection,
          name: name.trim(),
          description: description.trim() || null,
          cover_image: coverImage,
          parent_id: parentCollectionId,
        });
      } else {
        // 创建新合集，如果是 addTo 模式则设置 parent_id
        await createCollection({
          name: name.trim(),
          description: description.trim() || undefined,
          parent_id: mode === "addTo" ? parentCollectionId ?? undefined : defaultParentId,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败，请重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* 弹窗内容 */}
      <div className="relative w-full max-w-lg mx-4 bg-white dark:bg-neutral-900 rounded-lg shadow-2xl animate-fade-in border border-slate-200 dark:border-neutral-700">
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 p-1 rounded-md hover:bg-slate-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5 text-slate-400 dark:text-neutral-500" />
        </button>

        {/* 内容区域 */}
        <div className="p-6">
          {/* 标题 */}
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            {isEditing ? "编辑合集" : "创建新合集"}
          </h2>
          {!isEditing && (
            <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
              从侧边栏合集区域触发。创建空合集，稍后可以添加内容。
            </p>
          )}

          {/* 模式选择 - 仅在非编辑模式显示 */}
          {!isEditing && (
            <div className="mt-5 space-y-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === "create"}
                  onChange={() => setMode("create")}
                  className="w-4 h-4 text-blue-500 border-slate-300 dark:border-neutral-600 focus:ring-blue-500 dark:bg-neutral-800"
                />
                <FolderPlus className="w-4 h-4 text-amber-500" />
                <span className="text-sm text-slate-700 dark:text-slate-200">创建新合集</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === "addTo"}
                  onChange={() => setMode("addTo")}
                  className="w-4 h-4 text-blue-500 border-slate-300 dark:border-neutral-600 focus:ring-blue-500 dark:bg-neutral-800"
                />
                <ListPlus className="w-4 h-4 text-blue-500" />
                <span className="text-sm text-slate-700 dark:text-slate-200">添加到现有合集</span>
              </label>
            </div>
          )}

          {/* 表单 */}
          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            {/* 选择父级合集 - 在编辑模式或 addTo 模式显示 */}
            {(isEditing || mode === "addTo") && (
              <div className="flex items-start gap-4">
                <label className="w-12 flex-shrink-0 text-sm text-slate-600 dark:text-neutral-400 pt-2.5">
                  父合集
                </label>
                <select
                  value={parentCollectionId ?? ""}
                  onChange={(e) => setParentCollectionId(e.target.value || null)}
                  className={cn(
                    "flex-1 px-3 py-2.5 rounded-md border transition-colors",
                    "bg-slate-50 dark:bg-neutral-800",
                    "border-slate-200 dark:border-neutral-700",
                    "focus:border-blue-500 dark:focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-500/20",
                    "text-slate-800 dark:text-slate-200 text-sm"
                  )}
                >
                  <option value="">无（顶级合集）</option>
                  {(isEditing ? availableParentCollections : collections).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* 名称 */}
            <div className="flex items-start gap-4">
              <label className="w-12 flex-shrink-0 text-sm text-slate-600 dark:text-neutral-400 pt-2.5">
                名称
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：OpenAI 技术视频"
                className={cn(
                  "flex-1 px-3 py-2.5 rounded-md border transition-colors",
                  "bg-slate-50 dark:bg-neutral-800",
                  "border-slate-200 dark:border-neutral-700",
                  "focus:border-blue-500 dark:focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-500/20",
                  "text-slate-800 dark:text-slate-200 text-sm",
                  "placeholder:text-slate-400 dark:placeholder:text-neutral-500"
                )}
                autoFocus
              />
            </div>

            {/* 描述 */}
            <div className="flex items-start gap-4">
              <label className="w-12 flex-shrink-0 text-sm text-slate-600 dark:text-neutral-400 pt-2.5">
                描述
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="可选：关于此合集的简短描述"
                rows={3}
                className={cn(
                  "flex-1 px-3 py-2.5 rounded-md border transition-colors resize-none",
                  "bg-slate-50 dark:bg-neutral-800",
                  "border-slate-200 dark:border-neutral-700",
                  "focus:border-blue-500 dark:focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-500/20",
                  "text-slate-800 dark:text-slate-200 text-sm",
                  "placeholder:text-slate-400 dark:placeholder:text-neutral-500"
                )}
              />
            </div>

            {/* 封面图片 */}
            <div className="flex items-start gap-4">
              <label className="w-12 flex-shrink-0 text-sm text-slate-600 dark:text-neutral-400 pt-2.5">
                封面
              </label>
              <div className="flex-1">
                {coverImage ? (
                  <div className="relative inline-block">
                    <img
                      src={convertFileSrc(coverImage)}
                      alt="封面预览"
                      className="w-24 h-24 object-cover rounded-lg border border-slate-200 dark:border-neutral-700"
                    />
                    <button
                      type="button"
                      onClick={handleRemoveCover}
                      className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleSelectCover}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-md border border-dashed transition-colors cursor-pointer",
                      "border-slate-300 dark:border-neutral-600",
                      "text-slate-500 dark:text-neutral-400 text-sm",
                      "hover:border-blue-400 hover:text-blue-500 dark:hover:border-blue-500 dark:hover:text-blue-400"
                    )}
                  >
                    <Image className="w-4 h-4" />
                    选择封面图片
                  </button>
                )}
              </div>
            </div>

            {/* 错误提示 */}
            {error && (
              <div className="text-sm text-red-500 dark:text-red-400 pl-16">{error}</div>
            )}

            {/* 操作按钮 */}
            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className={cn(
                  "px-4 py-2 rounded-md transition-colors cursor-pointer text-sm font-medium",
                  "bg-slate-800 dark:bg-slate-100 hover:bg-slate-700 dark:hover:bg-white",
                  "text-white dark:text-slate-900",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                {isSubmitting ? "处理中..." : isEditing ? "保存修改" : mode === "create" ? "创建合集" : "确认添加"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
}
