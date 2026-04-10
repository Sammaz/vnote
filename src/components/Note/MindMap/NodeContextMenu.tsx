/**
 * 思维导图节点右键菜单组件
 * 提供节点操作功能：插入同级节点、插入子节点、删除节点、编辑节点等
 */

import { useEffect, useRef } from "react";
import {
  Plus,
  Trash2,
  Edit3,
  ArrowUp,
  ArrowDown,
  ChevronRight,
  ChevronDown,
  Copy,
  Scissors,
  Clipboard,
  Image,
  Camera,
} from "lucide-react";
import { cn } from "../../../utils/cn";
import { useGlassBg } from "../../../hooks/useGlassBg";

export interface NodeContextMenuProps {
  /** 菜单显示位置 X 坐标 */
  x: number;
  /** 菜单显示位置 Y 坐标 */
  y: number;
  /** 是否显示菜单 */
  visible: boolean;
  /** 关闭菜单回调 */
  onClose: () => void;
  /** 菜单操作回调 */
  onAction: (action: string) => void;
  /** 节点是否有子节点 */
  hasChildren?: boolean;
  /** 节点是否展开 */
  isExpanded?: boolean;
}

export function NodeContextMenu({
  x,
  y,
  visible,
  onClose,
  onAction,
  hasChildren = false,
  isExpanded = true,
}: NodeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const glassMenu = useGlassBg("menu");

  // 点击外部关闭菜单
  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // 延迟添加监听器，避免立即触发
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [visible, onClose]);

  // 按 ESC 关闭菜单
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [visible, onClose]);

  if (!visible) return null;

  const handleAction = (action: string) => {
    onAction(action);
    onClose();
  };

  const menuItems = [
    {
      label: "插入同级节点",
      icon: Plus,
      action: "insertSibling",
      shortcut: "Enter",
    },
    {
      label: "插入子节点",
      icon: ChevronRight,
      action: "insertChild",
      shortcut: "Tab",
    },
    {
      label: "插入父节点",
      icon: ArrowUp,
      action: "insertParent",
      shortcut: "Shift+Tab",
    },
    { type: "divider" },
    {
      label: "编辑节点",
      icon: Edit3,
      action: "edit",
      shortcut: "F2",
    },
    {
      label: "插入图片",
      icon: Image,
      action: "insertImage",
    },
    {
      label: "插入当前截图",
      icon: Camera,
      action: "insertCurrentScreenshot",
    },
    { type: "divider" },
    {
      label: "复制",
      icon: Copy,
      action: "copy",
      shortcut: "Ctrl+C",
    },
    {
      label: "剪切",
      icon: Scissors,
      action: "cut",
      shortcut: "Ctrl+X",
    },
    {
      label: "粘贴",
      icon: Clipboard,
      action: "paste",
      shortcut: "Ctrl+V",
    },
    { type: "divider" },
    {
      label: hasChildren
        ? isExpanded
          ? "收起所有子节点"
          : "展开所有子节点"
        : "展开/收起",
      icon: isExpanded ? ChevronDown : ChevronRight,
      action: "toggleExpand",
      disabled: !hasChildren,
    },
    { type: "divider" },
    {
      label: "上移节点",
      icon: ArrowUp,
      action: "moveUp",
      shortcut: "Ctrl+↑",
    },
    {
      label: "下移节点",
      icon: ArrowDown,
      action: "moveDown",
      shortcut: "Ctrl+↓",
    },
    { type: "divider" },
    {
      label: "删除节点",
      icon: Trash2,
      action: "delete",
      shortcut: "Delete",
      danger: true,
    },
  ];

  return (
    <div
      ref={menuRef}
      className={cn("fixed z-[9999] min-w-[220px] rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 py-1", glassMenu)}
      style={{
        left: `${x}px`,
        top: `${y}px`,
      }}
    >
      {menuItems.map((item, index) => {
        if (item.type === "divider") {
          return (
            <div
              key={`divider-${index}`}
              className="h-px bg-slate-200 dark:bg-slate-700 my-1"
            />
          );
        }

        const Icon = item.icon;
        const isDisabled = item.disabled;

        return (
          <button
            key={item.action}
            onClick={() => !isDisabled && item.action && handleAction(item.action)}
            disabled={isDisabled}
            className={`
              w-full px-3 py-2 flex items-center justify-between gap-3 text-left text-sm
              transition-colors
              ${
                isDisabled
                  ? "opacity-40 cursor-not-allowed"
                  : item.danger
                  ? "hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400"
                  : "hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
              }
            `}
          >
            <div className="flex items-center gap-2">
              {Icon && <Icon className="w-4 h-4" />}
              <span>{item.label}</span>
            </div>
            {item.shortcut && (
              <span className="text-xs text-slate-400 dark:text-slate-500">
                {item.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
