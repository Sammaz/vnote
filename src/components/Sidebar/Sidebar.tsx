import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Sparkles,
  Search,
  PanelLeftClose,
  PanelLeft,
  Video,
  MoreHorizontal,
  Trash2,
  FolderPlus,
  Library,
  ChevronRight,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { useApp } from "../../context/AppContext";
import { CollectionSection } from "../Collection";
import { CreateCollectionModal } from "../Collection/CreateCollectionModal";
import type { Note } from "../../types";
import logoImg from "../../assets/logo.png";

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  collapsed: boolean;
  onClick?: () => void;
}

function NavItem({ icon, label, active, collapsed, onClick }: NavItemProps) {
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
}

// 笔记记录列表项
interface NoteItemProps {
  note: Note;
}

function NoteItem({ note }: NoteItemProps) {
  const { setSelectedNoteId, setCurrentView, selectedNoteId, deleteNote, setSelectedFolder, collections, addNoteToCollection } = useApp();
  const [isHovered, setIsHovered] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showCollectionSubmenu, setShowCollectionSubmenu] = useState(false);
  const [showCreateCollectionModal, setShowCreateCollectionModal] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLDivElement>(null);
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

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    try {
      await deleteNote(note.id);
    } catch (error) {
      console.error("Failed to delete note:", error);
    }
  };

  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!showMenu && menuTriggerRef.current) {
      const rect = menuTriggerRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 4,
        left: rect.right - 176, // 菜单宽度 w-44 = 176px
      });
    }
    setShowMenu(!showMenu);
  };

  const handleMoveToCollection = async (collectionId: number) => {
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
          onClick={() => {
            setSelectedFolder(null); // 清除文件夹选中
            setSelectedNoteId(note.id);
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
              className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-neutral-700 flex-shrink-0"
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
          className="fixed w-44 py-1 bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-md shadow-lg z-[9999]"
          style={{ top: menuPosition.top, left: menuPosition.left }}
        >
          <div className="px-3 py-1.5 text-xs font-medium text-slate-500 dark:text-neutral-400 border-b border-slate-100 dark:border-neutral-700">
            操作
          </div>

          {/* 移动到合集 */}
          <div
            className="relative"
            onMouseEnter={() => setShowCollectionSubmenu(true)}
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

            {/* 合集子菜单 */}
            {showCollectionSubmenu && (
              <div className="absolute left-full top-0 ml-1 w-40 py-1 bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-md shadow-lg">
                {collections.map((collection) => (
                  <button
                    key={collection.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMoveToCollection(collection.id);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors cursor-pointer"
                  >
                    <Library className="w-3.5 h-3.5" />
                    <span className="truncate">{collection.name}</span>
                  </button>
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
            onClick={handleDelete}
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
    </>
  );
}

export function Sidebar() {
  const { sidebar, toggleSidebar, notes, currentView, setCurrentView, setSelectedFolder, setSelectedNoteId, notesInCollections } = useApp();
  const { collapsed } = sidebar;
  const [isHovered, setIsHovered] = useState(false);

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
    <aside
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        "sidebar h-full border-r border-slate-200 dark:border-vnote-border bg-white/80 dark:bg-vnote-card/50 backdrop-blur-xl",
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
          collapsed={collapsed}
          onClick={() => {
            setCurrentView("home");
            setSelectedFolder(null);
            setSelectedNoteId(null);
          }}
        />
      </nav>

      {/* 分隔线 */}
      <div className="mx-3 my-2 border-t border-slate-200 dark:border-vnote-border" />

      {/* 文件夹树 - 仅在展开时显示 */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto px-2 pb-4 animate-fade-in">
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

          <div className="space-y-0.5">
            {filteredNotes.slice(0, 10).map((note) => (
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
            {filteredNotes.length} 条笔记
          </div>
        )}
      </div>
    </aside>
  );
}
