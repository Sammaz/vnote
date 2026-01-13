import { createRoot } from "react-dom/client";
import type { MessageType } from "../components/ui/Message";
import { MessageItem } from "../components/ui/Message";

// 容器组件
let messageContainer: HTMLDivElement | null = null;
let messageRoot: any = null;

function getContainer() {
  if (!messageContainer) {
    messageContainer = document.createElement("div");
    messageContainer.className = "fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 items-center pointer-events-none";
    document.body.appendChild(messageContainer);
    messageRoot = createRoot(messageContainer);
  }
  return { container: messageContainer, root: messageRoot };
}

interface MessageInstance {
  id: number;
  element: React.ReactElement;
}

const instances: MessageInstance[] = [];
let nextId = 1;

function renderMessages() {
  const { root } = getContainer();
  root.render(
    <>
      {instances.map((instance) => (
        <div key={instance.id} className="pointer-events-auto">
          {instance.element}
        </div>
      ))}
    </>
  );
}

function show(content: string, type: MessageType = "info", duration = 3000): number {
  const id = nextId++;

  const element = (
    <MessageItem
      content={content}
      type={type}
      duration={duration}
      onClose={() => {
        const index = instances.findIndex((i) => i.id === id);
        if (index !== -1) {
          instances.splice(index, 1);
          renderMessages();
        }
      }}
    />
  );

  instances.push({ id, element });
  renderMessages();

  return id;
}

// 导出 message API
export const message = {
  success: (content: string, duration?: number) => show(content, "success", duration),
  error: (content: string, duration?: number) => show(content, "error", duration),
  warning: (content: string, duration?: number) => show(content, "warning", duration),
  info: (content: string, duration?: number) => show(content, "info", duration),
};
