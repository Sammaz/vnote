import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Folder, FolderOpen, MoreHorizontal, Trash2, Edit2 } from "lucide-react";
import { cn } from "../../utils/cn";
import { useApp } from "../../context/AppContext";
import type { Collection } from "../../types";

interface CollectionItemProps {
  collection: Collection;
  level: number;
  childCollections: Collection[];
  allCollections: Collection[];
  onEdit?: (collection: Collection) => void;
}

export function CollectionItem({
  collection,
  level,
  childCollections,
  allCollections,
  onEdit,
}: CollectionItemProps) {
  const {
    expandedCollections,
    toggleCollectionExpand,
    selectedCollectionId,
    setSelectedCollection,
    setCurrentView,
    deleteCollection,
  } = useApp();

  const [isHovered, setIsHovered] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLDivElement>(null);

  const isExpanded = expandedCollections.has(collection.id);
  const isSelected = selectedCollectionId === collection.id;
  const hasChildren = childCollections.length > 0;

  // 点击外部关闭菜单
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    }

    if (showMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showMenu]);

  const handleClick = () => {
    setSelectedCollection(collection.id);
    setCurrentView("collection");
    if (hasChildren) {
      toggleCollectionExpand(collection.id);
    }
  };

  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!showMenu && menuTriggerRef.current) {
      const rect = menuTriggerRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 4,
        left: rect.right - 144, // 144px is menu width (w-36 = 9rem = 144px)
      });
    }
    setShowMenu(!showMenu);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    try {
      await deleteCollection(collection.id);
    } catch (error) {
      console.error("Failed to delete collection:", error);
    }
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    onEdit?.(collection);
  };

  return (
    <div
      className="animate-fade-in"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        if (!showMenu) setShowMenu(false);
      }}
    >
      <div className="relative">
        <button
          onClick={handleClick}
          className={cn(
            "w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-all duration-150 cursor-pointer",
            "hover:bg-slate-100/80 dark:hover:bg-vnote-hover/80 text-sm hover:scale-[1.01]",
            isSelected
              ? "bg-blue-50/90 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400 shadow-sm"
              : "text-slate-500 dark:text-slate-400"
          )}
          style={{ paddingLeft: `${8 + level * 12}px` }}
        >
          {hasChildren ? (
            <ChevronDown
              className={cn(
                "w-3.5 h-3.5 transition-transform duration-200 flex-shrink-0",
                !isExpanded && "-rotate-90"
              )}
            />
          ) : (
            <span className="w-3.5" />
          )}
          {isExpanded ? (
            <FolderOpen className="w-4 h-4 text-amber-500 flex-shrink-0" />
          ) : (
            <Folder className="w-4 h-4 text-amber-500/70 flex-shrink-0" />
          )}
          <span className="flex-1 truncate text-left">{collection.name}</span>
          <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">
            {collection.item_count}
          </span>
          {(isHovered || showMenu) && (
            <div
              ref={menuTriggerRef}
              onClick={handleMenuClick}
              className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-neutral-700 flex-shrink-0"
            >
              <MoreHorizontal className="w-4 h-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300" />
            </div>
          )}
        </button>

        {/* 下拉菜单 - 使用 Portal 渲染到 body */}
        {showMenu && createPortal(
          <div
            ref={menuRef}
            className="fixed w-36 py-1 bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-md shadow-lg z-[9999]"
            style={{ top: menuPosition.top, left: menuPosition.left }}
          >
            <button
              onClick={handleEdit}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors cursor-pointer"
            >
              <Edit2 className="w-4 h-4" />
              <span>编辑</span>
            </button>
            <button
              onClick={handleDelete}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>删除</span>
            </button>
          </div>,
          document.body
        )}
      </div>

      {isExpanded && hasChildren && (
        <div className="mt-0.5">
          {childCollections.map((child) => (
            <CollectionItem
              key={child.id}
              collection={child}
              level={level + 1}
              childCollections={allCollections.filter((c) => c.parent_id === child.id)}
              allCollections={allCollections}
              onEdit={onEdit}
            />
          ))}
        </div>
      )}
    </div>
  );
}
