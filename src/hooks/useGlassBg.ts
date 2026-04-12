import { useMemo } from "react";
import { useSettings } from "../context/SettingsContext";

export type GlassLevel = "card" | "panel" | "modal" | "input" | "menu";

interface UseGlassBgOptions {
  blur?: boolean;
}

const LIGHT_NO_BG: Record<GlassLevel, string> = {
  card: "bg-white",
  panel: "bg-white",
  modal: "bg-white",
  input: "bg-white",
  menu: "bg-white",
};

const DARK_NO_BG: Record<GlassLevel, string> = {
  card: "dark:bg-vnote-card",
  panel: "dark:bg-vnote-card",
  modal: "dark:bg-neutral-900",
  input: "dark:bg-slate-800",
  menu: "dark:bg-neutral-800",
};

const LIGHT_WITH_BG: Record<GlassLevel, string> = {
  card: "bg-white/72",
  panel: "bg-white/78",
  modal: "bg-white/84",
  input: "bg-white/88",
  menu: "bg-white/90",
};

const DARK_WITH_BG: Record<GlassLevel, string> = {
  card: "dark:bg-vnote-card/76",
  panel: "dark:bg-vnote-card/72",
  modal: "dark:bg-neutral-900/82",
  input: "dark:bg-slate-800/84",
  menu: "dark:bg-neutral-800/86",
};

export function useGlassBg(level: GlassLevel = "card", options: UseGlassBgOptions = {}) {
  const { backgroundImage } = useSettings();
  const hasBackground = Boolean(backgroundImage);
  const { blur = true } = options;

  return useMemo(() => {
    const light = hasBackground ? LIGHT_WITH_BG[level] : LIGHT_NO_BG[level];
    const dark = hasBackground ? DARK_WITH_BG[level] : DARK_NO_BG[level];
    return blur ? `${light} ${dark} backdrop-blur-sm` : `${light} ${dark}`;
  }, [blur, hasBackground, level]);
}