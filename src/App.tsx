import { useState, useEffect } from "react";
import { Sun, Moon, Settings, Minus, Square, X, NotebookPen } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import SettingsPage from "./SettingsPage";
import "./index.css";

function App() {
  const [view, setView] = useState<'home' | 'settings'>('home');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    // Show window after React has mounted
    invoke("show_window").catch(console.error);
  }, []);

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => e.preventDefault();
    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const isTauri = typeof window !== "undefined" && Boolean((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

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
    try { await getCurrentWindow().minimize(); } catch {}
  };

  const handleMaximize = async () => {
    if (!isTauri) return;
    try { await getCurrentWindow().toggleMaximize(); } catch {}
  };

  const handleClose = async () => {
    if (!isTauri) return;
    try { await getCurrentWindow().close(); } catch {}
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-white dark:bg-vnote-bg text-slate-900 dark:text-slate-100 font-sans overflow-hidden transition-colors duration-200">
      <header
        className="flex items-center h-9 border-b border-slate-200 dark:border-vnote-border bg-white/80 dark:bg-vnote-card/80 backdrop-blur-xl"
        data-tauri-drag-region
        onMouseDown={handleTitleBarMouseDown}
      >
        <div className="flex items-center gap-2 pl-4 text-sm font-semibold text-slate-700 dark:text-slate-200">
          <NotebookPen size={18} className="text-blue-500" />
          VNote
        </div>

        <div className="flex-1" />

        <div className="flex items-center space-x-2 pr-2" data-tauri-drag-region="false">
          <button
            onClick={toggleTheme}
            className="p-2 text-slate-400 hover:text-orange-500 dark:text-slate-400 dark:hover:text-yellow-400 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-full transition-colors"
          >
            {theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <button
            onClick={() => setView(view === 'settings' ? 'home' : 'settings')}
            className={[
              "p-2 rounded-full transition-colors",
              view === 'settings'
                ? "text-slate-900 bg-slate-200 dark:text-slate-100 dark:bg-vnote-hover"
                : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover",
            ].join(" ")}
          >
            <Settings size={18} />
          </button>
        </div>

        <div className="flex items-center" data-tauri-drag-region="false">
          <button
            onClick={handleMinimize}
            className="h-9 w-10 flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover transition-colors"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={handleMaximize}
            className="h-9 w-10 flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover transition-colors"
          >
            <Square size={12} />
          </button>
          <button
            onClick={handleClose}
            className="h-9 w-12 flex items-center justify-center text-slate-400 hover:text-white hover:bg-red-500 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        {view === 'settings' ? (
          <SettingsPage
            currentTheme={theme}
            onThemeChange={(t) => {
              setTheme(t);
              if (t === 'dark') document.documentElement.classList.add('dark');
              else document.documentElement.classList.remove('dark');
            }}
            onClose={() => setView('home')}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-400">
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
