import { invoke } from "@tauri-apps/api/core";

const isTauriEnvironment =
  typeof window !== "undefined" &&
  Boolean((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

export function resolveExternalHttpUrl(raw: string, baseUrl?: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("file:")) {
    return null;
  }
  if (trimmed.startsWith("#") || trimmed.startsWith("mailto:")) {
    return null;
  }

  try {
    const url = new URL(trimmed, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

export async function openExternalUrl(raw: string): Promise<void> {
  const href = resolveExternalHttpUrl(raw);
  if (!href) return;

  if (isTauriEnvironment) {
    try {
      await invoke("open_external_url", { url: href });
      return;
    } catch (error) {
      console.warn("Failed to open external url:", error);
    }
  }

  window.open(href, "_blank", "noopener,noreferrer");
}

export function handleExternalLinkClick(
  event: { preventDefault(): void; stopPropagation(): void },
  href?: string | null,
): boolean {
  const resolved = href ? resolveExternalHttpUrl(href) : null;
  if (!resolved) return false;
  event.preventDefault();
  event.stopPropagation();
  void openExternalUrl(resolved);
  return true;
}
