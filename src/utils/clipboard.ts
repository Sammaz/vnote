import { invoke } from "@tauri-apps/api/core";

const isTauriEnvironment =
  typeof window !== "undefined" &&
  Boolean((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

async function copyWithNavigator(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document !== "undefined") {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    const successful = document.execCommand("copy");
    document.body.removeChild(textarea);

    if (successful) {
      return;
    }
  }

  throw new Error("Clipboard API is unavailable");
}

export async function copyText(text: string): Promise<void> {
  if (isTauriEnvironment) {
    try {
      await invoke("copy_text_to_clipboard", { text });
      return;
    } catch {
      // Fall through to browser clipboard implementations.
    }
  }

  await copyWithNavigator(text);
}
