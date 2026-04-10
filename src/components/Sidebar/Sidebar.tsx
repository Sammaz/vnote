import { useState, useRef, useEffect, memo, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Sparkles,
  Search,
  PanelLeftClose,
  PanelLeft,
  Video,
  MoreHorizontal,
  Trash2,
  Edit3,
  FolderPlus,
  Library,
  ChevronRight,
  ChevronDown,
  BookOpen,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { useApp } from "../../context/AppContext";
import { useInitializationRuntime } from "../../context/InitializationRuntimeContext";
import { useGlassBg } from "../../hooks/useGlassBg";
import { useCollections } from "../../context/CollectionsContext";
import { CollectionSection } from "../Collection";
import { CreateCollectionModal } from "../Collection/CreateCollectionModal";
import { EditNoteModal } from "../Notes/EditNoteModal";
import { GlobalSearchModal } from "../Notes/GlobalSearchModal";
import { ConfirmDialog } from "../common/ConfirmDialog";
import type { Note, Collection } from "../../types";
import { VIEW_TYPES } from "../../types";
import logoImg from "../../assets/logo.png";

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  collapsed: boolean;
  onClick?: () => void;
}

// 导航项组件 - 使用 memo 优化避免不必要的重渲染
const NavItem = memo(function NavItem({ icon, label, active, collapsed, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 cursor-pointer",
        "hover:bg-slate-100/80 dark:hover:bg-vnote-hover/80 hover:scale-[1.02]",
        active ? "bg-blue-50/90 dark:bg-blue-600/20 text-blue-500 dark:text-blue-400 shadow-sm" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200",
        collapsed && "justify-center px-0"
      )}
      title={collapsed ? label : undefined}
    >
      <span className="flex-shrink-0">{icon}</span>
      {!collapsed && <span className="text-sm font-medium truncate">{label}</span>}
    </button>
  );
});

// 树形合集菜单项组件 - 使用 memo 优化
const CollectionTreeMenuItem = memo(function CollectionTreeMenuItem({
  collection,
  allCollections,
  level,
  onSelect,
}: {
  collection: Collection;
  allCollections: Collection[];
  level: number;
  onSelect: (id: string) => void;
}) {
  const { expandedCollections, toggleCollectionExpand } = useCollections();
  const expanded = expandedCollections.has(collection.id);
  const children = allCollections.filter((c) => c.parent_id === collection.id);
  const hasChildren = children.length > 0;

  return (
    <div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onSelect(collection.id);
        }}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors cursor-pointer"
        style={{ paddingLeft: `${12 + level * 12}px` }}
      >
        <span
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) toggleCollectionExpand(collection.id);
          }}
          className={cn(
            "w-4 h-4 flex items-center justify-center flex-shrink-0",
            hasChildren && "hover:bg-slate-200 dark:hover:bg-neutral-600 rounded cursor-pointer"
          )}
        >
          {hasChildren && (
            expanded ? (
              <ChevronDown className="w-3 h-3 text-slate-400" />
            ) : (
              <ChevronRight className="w-3 h-3 text-slate-400" />
            )
          )}
        </span>
        <Library className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="truncate">{collection.name}</span>
      </button>
      {hasChildren && expanded && (
        <div>
          {children.map((child) => (
            <CollectionTreeMenuItem
              key={child.id}
              collection={child}
              allCollections={allCollections}
              level={level + 1}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
});

// 笔记记录列表项
interface NoteItemProps {
  note: Note;
}

// 笔记记录列表项 - 使用 memo 优化避免不必要的重渲染
const NoteItem = memo(function NoteItem({ note }: NoteItemProps) {
  const { setSelectedNoteId, setCurrentView, selectedNoteId, deleteNote, setSelectedFolder, setSelectedCollection, collections, addNoteToCollection } = useApp();
  const { removeNoteFromRuntime } = useInitializationRuntime();
  const glassMenu = useGlassBg("menu");
  const [isHovered, setIsHovered] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showCollectionSubmenu, setShowCollectionSubmenu] = useState(false);
  const [submenuAlignBottom, setSubmenuAlignBottom] = useState(false);
  const [showCreateCollectionModal, setShowCreateCollectionModal] = useState(false);
  const [showEditNoteModal, setShowEditNoteModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTriggerRect, setDeleteTriggerRect] = useState<DOMRect | null>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const noteItemRef = useRef<HTMLButtonElement>(null);
  const menuTriggerRef = useRef<HTMLDivElement>(null);
  const collectionMenuRef = useRef<HTMLDivElement>(null);
  const isSelected = selectedNoteId === note.id;

  // 点击外部关闭菜单
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
        setShowCollectionSubmenu(false);
      }
    }

    if (showMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showMenu]);

  const handleDeleteClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setDeleteTriggerRect(noteItemRef.current?.getBoundingClientRect() ?? null);
    setShowMenu(false);
    setShowDeleteConfirm(true);
  };

  const handleCancelDelete = useCallback(() => {
    setShowDeleteConfirm(false);
    setDeleteTriggerRect(null);
  }, []);

  const handleConfirmDelete = async () => {
    try {
      // 先从初始化运行任务中移除（包括中止正在运行的任务）
      await removeNoteFromRuntime(note.id);
      await deleteNote(note.id);
      handleCancelDelete();
    } catch (error) {
      console.error("Failed to delete note:", error);
    }
  };

  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!showMenu && menuTriggerRef.current) {
      const rect = menuTriggerRef.current.getBoundingClientRect();
      const menuHeight = 120; // 菜单预估高度
      const menuWidth = 176; // 菜单宽度 w-44 = 176px
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;

      // 检查向下显示是否会超出视口底部
      const showAbove = rect.bottom + menuHeight + 4 > viewportHeight;
      // 检查向左显示是否会超出视口左侧
      const adjustLeft = rect.right - menuWidth < 0;

      setMenuPosition({
        top: showAbove ? rect.top - menuHeight - 4 : rect.bottom + 4,
        left: adjustLeft ? Math.max(8, rect.left) : Math.min(rect.right - menuWidth, viewportWidth - menuWidth - 8),
      });
    }
    setShowMenu(!showMenu);
  };

  const handleMoveToCollection = async (collectionId: string) => {
    try {
      await addNoteToCollection(collectionId, note.id);
      setShowMenu(false);
      setShowCollectionSubmenu(false);
    } catch (error) {
      console.error("Failed to move note to collection:", error);
    }
  };

  const handleCreateNewCollection = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    setShowCollectionSubmenu(false);
    setShowCreateCollectionModal(true);
  };

  return (
    <>
      <div
        className="relative"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => {
          setIsHovered(false);
          if (!showMenu) setShowMenu(false);
        }}
      >
        <button
          ref={noteItemRef}
          onClick={() => {
            setSelectedFolder(null); // 清除文件夹选中
            setSelectedNoteId(note.id);
            setSelectedCollection(null); // 清除合集选中
            setCurrentView("note");
          }}
          className={cn(
            "w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-all duration-150 group cursor-pointer",
            "text-sm",
            isSelected
              ? "bg-blue-50 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400"
              : "hover:bg-slate-100 dark:hover:bg-vnote-hover text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          )}
        >
          <Video className="w-4 h-4 text-blue-400 flex-shrink-0" />
          <span className="flex-1 truncate text-left">{note.title}</span>
          {(isHovered || showMenu) && (
            <div
              ref={menuTriggerRef}
              onClick={handleMenuClick}
              className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-neutral-700 flex-shrink-0 cursor-pointer"
            >
              <MoreHorizontal className="w-4 h-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300" />
            </div>
          )}
        </button>
      </div>

      {/* 下拉菜单 - Portal */}
      {showMenu && createPortal(
        <div
          ref={menuRef}
          className={`fixed w-44 py-1 ${glassMenu} border border-slate-200 dark:border-neutral-700 rounded-md shadow-lg z-[9999]`}
          style={{ top: menuPosition.top, left: menuPosition.left }}
        >
          <div className="px-3 py-1.5 text-xs font-medium text-slate-500 dark:text-neutral-400 border-b border-slate-100 dark:border-neutral-700">
            操作
          </div>

          {/* 移动到合集 */}
          <div
            ref={collectionMenuRef}
            className="relative"
            onMouseEnter={() => {
              if (collectionMenuRef.current) {
                const rect = collectionMenuRef.current.getBoundingClientRect();
                const submenuMaxHeight = 256; // max-h-64 = 256px
                setSubmenuAlignBottom(rect.top + submenuMaxHeight > window.innerHeight);
              }
              setShowCollectionSubmenu(true);
            }}
            onMouseLeave={() => setShowCollectionSubmenu(false)}
          >
            <button
              className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Library className="w-3.5 h-3.5" />
                <span>移动到合集</span>
              </div>
              <ChevronRight className="w-3 h-3" />
            </button>

            {/* 合集子菜单 - 树形展示 */}
            {showCollectionSubmenu && (
              <div className={`absolute left-full ${submenuAlignBottom ? 'bottom-0' : 'top-0'} ml-1 w-48 py-1 ${glassMenu} border border-slate-200 dark:border-neutral-700 rounded-md shadow-lg max-h-64 overflow-y-auto`}>
                {collections.filter((c) => c.parent_id === null).map((collection) => (
                  <CollectionTreeMenuItem
                    key={collection.id}
                    collection={collection}
                    allCollections={collections}
                    level={0}
                    onSelect={handleMoveToCollection}
                  />
                ))}
                {collections.length > 0 && (
                  <div className="my-1 border-t border-slate-100 dark:border-neutral-700" />
                )}
                <button
                  onClick={handleCreateNewCollection}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors cursor-pointer"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  <span>新合集</span>
                </button>
              </div>
            )}
          </div>

          <div className="my-1 border-t border-slate-100 dark:border-neutral-700" />

          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(false);
              setShowEditNoteModal(true);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors cursor-pointer"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>编辑笔记</span>
          </button>

          <div className="my-1 border-t border-slate-100 dark:border-neutral-700" />

          <button
            onClick={handleDeleteClick}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>删除</span>
          </button>
        </div>,
        document.body
      )}

      {/* 创建合集弹窗 */}
      {showCreateCollectionModal && (
        <CreateCollectionModal
          onClose={() => setShowCreateCollectionModal(false)}
        />
      )}

      {/* 编辑笔记弹窗 */}
      {showEditNoteModal && (
        <EditNoteModal note={note} onClose={() => setShowEditNoteModal(false)} />
      )}

      <ConfirmDialog
        open={showDeleteConfirm}
        title="确认删除"
        message={`你将删除笔记“${note.title}”。\n删除后将无法恢复。`}
        confirmText="确认删除"
        cancelText="取消"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
        danger
        placement="anchored"
        triggerRect={deleteTriggerRect}
      />
    </>
  );
});

export function Sidebar() {
  const { sidebar, toggleSidebar, notes, currentView, setCurrentView, setSelectedFolder, setSelectedNoteId, notesInCollections } = useApp();
  const { collapsed } = sidebar;
  const glassPanel = useGlassBg("panel");
  const [isHovered, setIsHovered] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);

  // 过滤掉已添加到合集的笔记
  const filteredNotes = notes.filter((note) => !notesInCollections.has(note.id));

  // 点击折叠
  const handleCollapse = () => {
    toggleSidebar();
  };

  // 点击展开
  const handleExpand = () => {
    toggleSidebar();
  };

  const handleMouseEnter = () => {
    if (collapsed) {
      setIsHovered(true);
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  return (
    <>
    <aside
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        "sidebar h-full border-r border-slate-200 dark:border-vnote-border",
        glassPanel,
        "flex flex-col relative transition-all duration-300 ease-in-out",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* 顶部区域：Logo + 折叠按钮 */}
      <div className="flex items-center justify-between h-12 px-3 border-b border-slate-200/50 dark:border-vnote-border/50">
        {!collapsed ? (
          <>
            <div className="flex items-center gap-2">
              <img src={logoImg} alt="VNote" className="w-8 h-8 rounded-lg" />
            </div>
            <button
              onClick={handleCollapse}
              className={cn(
                "flex items-center justify-center w-7 h-7 rounded-md transition-all duration-200 cursor-pointer",
                "text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover"
              )}
              title="折叠侧边栏"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </>
        ) : (
          <div className="w-full flex items-center justify-center">
            <button
              onClick={handleExpand}
              className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-vnote-hover transition-colors cursor-pointer"
              title="展开侧边栏"
            >
              {isHovered ? (
                <PanelLeft className="w-5 h-5 text-slate-500 dark:text-slate-400" />
              ) : (
                <img src={logoImg} alt="VNote" className="w-7 h-7 rounded-lg" />
              )}
            </button>
          </div>
        )}
      </div>

      {/* 导航区域 */}
      <nav className="p-2 space-y-1">
        <NavItem
          icon={<Sparkles className="w-5 h-5" />}
          label="新笔记"
          active={currentView === "home"}
          collapsed={collapsed}
          onClick={() => {
            setCurrentView("home");
            setSelectedFolder(null);
            setSelectedNoteId(null);
          }}
        />
        <NavItem
          icon={<Search className="w-5 h-5" />}
          label="全局搜索"
          active={false}
          collapsed={collapsed}
          onClick={() => setShowSearchModal(true)}
        />
        <NavItem
          icon={<BookOpen className="w-5 h-5" />}
          label="知识库"
          active={currentView === VIEW_TYPES.KNOWLEDGE_BASE}
          collapsed={collapsed}
          onClick={() => {
            setCurrentView(VIEW_TYPES.KNOWLEDGE_BASE);
            setSelectedFolder(null);
            setSelectedNoteId(null);
          }}
        />
      </nav>

      {/* 分隔线 */}
      <div className="mx-3 my-2 border-t border-slate-200 dark:border-vnote-border" />

      {/* 文件夹树 - 仅在展开时显示 */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto scrollbar-hide px-2 pb-4 animate-fade-in">
          {/* 合集区域 */}
          <CollectionSection />

          {/* 分隔线 */}
          <div className="mx-1 my-3 border-t border-slate-200 dark:border-vnote-border" />

          {/* 笔记记录 */}
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              笔记记录
            </span>
          </div>

          {/* 笔记列表 */}
          <div className="space-y-0.5">
            {filteredNotes.map((note) => (
              <NoteItem key={note.id} note={note} />
            ))}
          </div>
        </div>
      )}

      {/* 收缩状态下的点击展开区域 */}
      {collapsed && (
        <div
          onClick={handleExpand}
          className={cn(
            "flex-1 cursor-pointer flex flex-col items-center justify-center mx-2 my-2 rounded-lg transition-all duration-200",
            isHovered
              ? "bg-gradient-to-b from-blue-500/10 to-blue-600/5 dark:from-blue-400/10 dark:to-blue-500/5"
              : ""
          )}
          title="展开侧边栏"
        >
          {isHovered ? (
            <span className="text-xs text-slate-600 dark:text-slate-400 writing-vertical whitespace-nowrap">
              展开侧边栏
            </span>
          ) : (
            <div className="w-1 h-24 bg-gradient-to-b from-transparent via-slate-300 dark:via-slate-600 to-transparent rounded-full opacity-50" />
          )}
        </div>
      )}

      {/* 底部空间 */}
      <div className="p-2 mt-auto">
        {!collapsed && (
          <div className="text-xs text-slate-500 dark:text-slate-600 text-center animate-fade-in">
            {notes.length} 条笔记
          </div>
        )}
      </div>
    </aside>

    {/* 全局搜索弹框 */}
    <GlobalSearchModal open={showSearchModal} onClose={() => setShowSearchModal(false)} />
    </>
  );
}
