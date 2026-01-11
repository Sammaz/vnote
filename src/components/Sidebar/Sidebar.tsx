import { useState, useRef, useEffect } from "react";
import {
  Sparkles,
  FolderClosed,
  FolderOpen,
  Search,
  PanelLeftClose,
  PanelLeft,
  ChevronDown,
  Video,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { useApp } from "../../context/AppContext";
import type { Folder, Note } from "../../types";
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
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200",
        "hover:bg-slate-100 dark:hover:bg-vnote-hover",
        active ? "bg-blue-50 dark:bg-blue-600/20 text-blue-500 dark:text-blue-400" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200",
        collapsed && "justify-center px-0"
      )}
      title={collapsed ? label : undefined}
    >
      <span className="flex-shrink-0">{icon}</span>
      {!collapsed && <span className="text-sm font-medium truncate">{label}</span>}
    </button>
  );
}

interface FolderItemProps {
  folder: Folder;
  level: number;
  childFolders: Folder[];
  allFolders: Folder[];
}

function FolderItem({
  folder,
  level,
  childFolders,
  allFolders,
}: FolderItemProps) {
  const { sidebar, toggleFolderExpand, setSelectedFolder } =
    useApp();
  const isExpanded = sidebar.expandedFolders.has(folder.id);
  const isSelected = sidebar.selectedFolderId === folder.id;
  const hasChildren = childFolders.length > 0;

  return (
    <div className="animate-fade-in">
      <button
        onClick={() => {
          setSelectedFolder(folder.id);
          if (hasChildren) {
            toggleFolderExpand(folder.id);
          }
        }}
        className={cn(
          "w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-all duration-150",
          "hover:bg-slate-100 dark:hover:bg-vnote-hover text-sm",
          isSelected ? "bg-slate-100 dark:bg-vnote-hover text-slate-700 dark:text-slate-200" : "text-slate-500 dark:text-slate-400"
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
          <FolderOpen className="w-4 h-4 text-blue-400 flex-shrink-0" />
        ) : (
          <FolderClosed className="w-4 h-4 text-slate-500 flex-shrink-0" />
        )}
        <span className="truncate">{folder.name}</span>
      </button>

      {isExpanded && hasChildren && (
        <div className="mt-0.5">
          {/* 子文件夹 */}
          {childFolders.map((child) => (
            <FolderItem
              key={child.id}
              folder={child}
              level={level + 1}
              childFolders={allFolders.filter((f) => f.parentId === child.id)}
              allFolders={allFolders}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// 笔记记录列表项
interface NoteItemProps {
  note: Note;
}

function NoteItem({ note }: NoteItemProps) {
  const { setSelectedNoteId, setCurrentView, selectedNoteId, deleteNote } = useApp();
  const [isHovered, setIsHovered] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isSelected = selectedNoteId === note.id;

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
    setShowMenu(!showMenu);
  };

  return (
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
          setSelectedNoteId(note.id);
          setCurrentView("note");
        }}
        className={cn(
          "w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-all duration-150 group",
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
            onClick={handleMenuClick}
            className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-neutral-700 flex-shrink-0"
          >
            <MoreHorizontal className="w-4 h-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300" />
          </div>
        )}
      </button>

      {/* 下拉菜单 */}
      {showMenu && (
        <div
          ref={menuRef}
          className="absolute right-0 top-full mt-1 w-36 py-1 bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-md shadow-lg z-50"
        >
          <div className="px-3 py-1.5 text-xs font-medium text-slate-500 dark:text-neutral-400 border-b border-slate-100 dark:border-neutral-700">
            操作
          </div>
          <button
            onClick={handleDelete}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>删除</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const { sidebar, toggleSidebar, folders, notes, currentView, setCurrentView } = useApp();
  const { collapsed } = sidebar;
  const [isHovered, setIsHovered] = useState(false);

  // 获取根文件夹
  const rootFolders = folders.filter((f) => f.parentId === null);

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
                "flex items-center justify-center w-7 h-7 rounded-md transition-all duration-200",
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
              className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-vnote-hover transition-colors"
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
          onClick={() => setCurrentView("home")}
        />
        <NavItem
          icon={<Search className="w-5 h-5" />}
          label="全局搜索"
          collapsed={collapsed}
          onClick={() => {
            setCurrentView("home");
            // 聚焦搜索框
          }}
        />
      </nav>

      {/* 分隔线 */}
      <div className="mx-3 my-2 border-t border-slate-200 dark:border-vnote-border" />

      {/* 文件夹树 - 仅在展开时显示 */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto px-2 pb-4 animate-fade-in">
          {/* 资源库 */}
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              资源库
            </span>
          </div>

          <div className="space-y-0.5">
            {rootFolders.map((folder) => (
              <FolderItem
                key={folder.id}
                folder={folder}
                level={0}
                childFolders={folders.filter((f) => f.parentId === folder.id)}
                allFolders={folders}
              />
            ))}
          </div>

          {/* 分隔线 */}
          <div className="mx-1 my-3 border-t border-slate-200 dark:border-vnote-border" />

          {/* 笔记记录 */}
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              笔记记录
            </span>
          </div>

          <div className="space-y-0.5">
            {notes.slice(0, 10).map((note) => (
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
  );
}
