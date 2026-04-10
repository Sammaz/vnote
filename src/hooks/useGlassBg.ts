import { useMemo } from "react";
import { useSettings } from "../context/SettingsContext";

export type GlassLevel = "card" | "panel" | "modal" | "input" | "menu";

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
  card: "bg-white/80",
  panel: "bg-white/72",
  modal: "bg-white/74",
  input: "bg-white/70",
  menu: "bg-white/82",
};

const DARK_WITH_BG: Record<GlassLevel, string> = {
  card: "dark:bg-vnote-card/56",
  panel: "dark:bg-vnote-card/50",
  modal: "dark:bg-neutral-900/60",
  input: "dark:bg-slate-800/70",
  menu: "dark:bg-neutral-800/72",
};

export function useGlassBg(level: GlassLevel = "card") {
  const { backgroundImage } = useSettings();
  const hasBackground = Boolean(backgroundImage);

  return useMemo(() => {
    const light = hasBackground ? LIGHT_WITH_BG[level] : LIGHT_NO_BG[level];
    const dark = hasBackground ? DARK_WITH_BG[level] : DARK_NO_BG[level];
    return `${light} ${dark} backdrop-blur-sm`;
  }, [hasBackground, level]);
}