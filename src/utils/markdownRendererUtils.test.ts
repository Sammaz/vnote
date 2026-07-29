import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { parseEvidenceRanks, renderDecoratedReactNode } from "./markdownRendererUtils";

describe("parseEvidenceRanks", () => {
  it("解析单个证据编号", () => {
    expect(parseEvidenceRanks("[证据1]")).toEqual([1]);
    expect(parseEvidenceRanks("[证据 2]")).toEqual([2]);
  });

  it("解析带半角逗号的多个编号", () => {
    expect(parseEvidenceRanks("[证据1,2]")).toEqual([1, 2]);
    expect(parseEvidenceRanks("[证据1, 3]")).toEqual([1, 3]);
  });

  it("解析带全角逗号的多个编号", () => {
    expect(parseEvidenceRanks("[证据1，2，3]")).toEqual([1, 2, 3]);
  });

  it("解析带顿号的多个编号", () => {
    expect(parseEvidenceRanks("[证据1、2]")).toEqual([1, 2]);
  });

  it("忽略非数字和零", () => {
    expect(parseEvidenceRanks("[证据1,,2]")).toEqual([1, 2]);
    expect(parseEvidenceRanks("[证据0]")).toEqual([]);
  });
});

describe("timestamp range decoration", () => {
  it("seeks to the start of a clickable timestamp range", () => {
    const dispatchEventSpy = vi.mocked(window.dispatchEvent);
    dispatchEventSpy.mockClear();

    render(React.createElement(
      React.Fragment,
      null,
      renderDecoratedReactNode(
        "(0:01 - 0:15)",
        { enableSeekTimestamps: true, enableTimestampRanges: true },
      ),
    ));

    fireEvent.click(screen.getByRole("button", { name: "(0:01 - 0:15)" }));

    expect(dispatchEventSpy).toHaveBeenCalledOnce();
    const event = dispatchEventSpy.mock.calls[0]?.[0] as CustomEvent<{ time: number }>;
    expect(event.type).toBe("seek-video");
    expect(event.detail.time).toBe(1);
  });

  it("keeps timestamp ranges non-interactive when seeking is disabled", () => {
    render(React.createElement(
      React.Fragment,
      null,
      renderDecoratedReactNode(
        "(1:02:03 - 1:04:05)",
        { enableSeekTimestamps: false, enableTimestampRanges: true },
      ),
    ));

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("(1:02:03 - 1:04:05)")).toHaveClass("timestamp-range");
  });
});
