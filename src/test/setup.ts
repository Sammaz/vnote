/**
 * Vitest 测试环境配置
 * 设置 jsdom 环境和全局 mock
 */

import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock window.CustomEvent for jsdom
if (typeof window !== "undefined" && !window.CustomEvent) {
  // @ts-expect-error CustomEvent polyfill for jsdom
  window.CustomEvent = class CustomEvent extends Event {
    detail: unknown;
    constructor(event: string, params?: { detail?: unknown }) {
      super(event);
      this.detail = params?.detail;
    }
  };
}

// Mock window.dispatchEvent
vi.spyOn(window, "dispatchEvent").mockImplementation(() => true);
