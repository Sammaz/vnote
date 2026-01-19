import { useEffect, useState } from "react";
import { Sun, Moon, Minus, Square, X, Settings } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import SettingsPage from "./SettingsPage";
import { AppProvider, useApp } from "./context/AppContext";
import { InitTaskQueueProvider } from "./context/InitTaskQueueContext";
import { Sidebar } from "./components/Sidebar";
import { HomePage } from "./components/HomePage";
import { NotePage } from "./components/Note";
import { CollectionPage } from "./components/Collection";
import { RecentNotesPage, SearchPage } from "./components/Notes";
import "./index.css";

function AppContent() {
  const { currentView, setCurrentView } = useApp();
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [previousView, setPreviousView] = useState<"home" | "note" | "collection" | "recent-notes" | "search">("home");

  useEffect(() => {
    // Load saved theme and show window
    const init = async () => {
      try {
        const settings = await invoke<{ theme: string; tray_enabled: boolean }>("get_app_settings");
        const savedTheme = settings.theme === "light" ? "light" : "dark";
        if (savedTheme === "dark") {
          document.documentElement.classList.add("dark");
        } else {
          document.documentElement.classList.remove("dark");
        }
        setTheme(savedTheme);
      } catch {
        // Default to dark theme
        document.documentElement.classList.add("dark");
        setTheme("dark");
      }
      invoke("show_window").catch(console.error);
    };
    init();
  }, []);

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  const isTauri =
    typeof window !== "undefined" &&
    Boolean((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

  const handleTitleBarMouseDown = (event: React.MouseEvent<HTMLElement>) => {
    if (!isTauri || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-tauri-drag-region="false"]')) return;
    try {
      getCurrentWindow().startDragging();
    } catch {
      // Ignore
    }
  };

  const handleMinimize = async () => {
    if (!isTauri) return;
    try {
      await getCurrentWindow().minimize();
    } catch {}
  };

  const handleMaximize = async () => {
    if (!isTauri) return;
    try {
      await getCurrentWindow().toggleMaximize();
    } catch {}
  };

  const handleClose = async () => {
    if (!isTauri) return;
    try {
      await getCurrentWindow().close();
    } catch {}
  };

  const toggleTheme = async () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    if (newTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    setTheme(newTheme);
    try {
      await invoke("set_theme", { theme: newTheme });
    } catch (error) {
      console.error("Failed to save theme:", error);
    }
  };

  const handleThemeChange = (newTheme: "light" | "dark") => {
    if (newTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    setTheme(newTheme);
  };

  const isSettingsView = currentView === "settings";

  const handleSettingsClick = () => {
    if (isSettingsView) {
      // 在设置页面时，点击返回之前的视图
      setCurrentView(previousView);
    } else {
      // 不在设置页面时，保存当前视图并进入设置
      setPreviousView(currentView as "home" | "note" | "collection" | "recent-notes" | "search");
      setCurrentView("settings");
    }
  };

  const handleSettingsClose = () => {
    setCurrentView(previousView);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-50 dark:bg-vnote-bg text-slate-900 dark:text-slate-100 font-sans overflow-hidden transition-colors duration-300">
      {/* Title Bar */}
      <header
        className="flex items-center h-9 border-b border-slate-200/60 dark:border-vnote-border/60 bg-white/70 dark:bg-vnote-card/70 backdrop-blur-2xl flex-shrink-0 shadow-sm"
        data-tauri-drag-region
        onMouseDown={handleTitleBarMouseDown}
      >
        <div className="flex items-center gap-2 pl-4 text-sm font-semibold text-slate-700 dark:text-slate-200">
          VNote
        </div>

        <div className="flex-1" />

        <div className="flex items-center space-x-1 pr-2" data-tauri-drag-region="false">
          <button
            onClick={toggleTheme}
            className="p-2 text-slate-400 hover:text-orange-500 dark:text-slate-400 dark:hover:text-yellow-400 hover:bg-slate-100/80 dark:hover:bg-vnote-hover/80 rounded-full transition-all duration-200 cursor-pointer hover:scale-110"
          >
            <Sun size={18} className="hidden dark:block" />
            <Moon size={18} className="block dark:hidden" />
          </button>
          <button
            onClick={handleSettingsClick}
            className={[
              "p-2 rounded-full transition-all duration-200 cursor-pointer",
              isSettingsView
                ? "text-blue-500 bg-blue-500/15 dark:text-blue-400 dark:bg-blue-400/15 scale-110"
                : "text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100/80 dark:hover:bg-vnote-hover/80 hover:scale-110"
            ].join(" ")}
            title="设置"
          >
            <Settings size={18} />
          </button>
        </div>

        <div className="flex items-center" data-tauri-drag-region="false">
          <button
            onClick={handleMinimize}
            className="h-9 w-10 flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100/80 dark:hover:bg-vnote-hover/80 transition-all duration-200 cursor-pointer"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={handleMaximize}
            className="h-9 w-10 flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100/80 dark:hover:bg-vnote-hover/80 transition-all duration-200 cursor-pointer"
          >
            <Square size={12} />
          </button>
          <button
            onClick={handleClose}
            className="h-9 w-12 flex items-center justify-center text-slate-400 hover:text-white hover:bg-red-500/90 transition-all duration-200 cursor-pointer hover:shadow-lg hover:shadow-red-500/30"
          >
            <X size={14} />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - 仅在非设置页面显示 */}
        {!isSettingsView && <Sidebar />}

        {/* Main View */}
        <main className="flex-1 flex overflow-hidden bg-slate-50 dark:bg-vnote-bg">
          {isSettingsView ? (
            <SettingsPage
              currentTheme={theme}
              onThemeChange={handleThemeChange}
              onClose={handleSettingsClose}
            />
          ) : currentView === "note" ? (
            <NotePage />
          ) : currentView === "collection" ? (
            <CollectionPage />
          ) : currentView === "recent-notes" ? (
            <RecentNotesPage />
          ) : currentView === "search" ? (
            <SearchPage />
          ) : (
            <HomePage />
          )}
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <AppProvider>
      <InitTaskQueueProvider>
        <AppContent />
      </InitTaskQueueProvider>
    </AppProvider>
  );
}

export default App;
