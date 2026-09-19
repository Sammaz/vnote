import React from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { EvidenceCitation } from "../components/Markdown/EvidenceCitation";
import { handleExternalLinkClick } from "./openExternalUrl";

const BRACKET_TIMESTAMP_RE = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/;
const CLOCK_TIMESTAMP_RE = /⏱\s*(\d{1,2}:\d{2}(?::\d{2})?)/;
const CHINESE_TIMESTAMP_RE = /（时间：(\d{1,2}:\d{2}(?::\d{2})?)）/;
const TIMESTAMP_RANGE_RE = /^\((\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*\d{1,2}:\d{2}(?::\d{2})?\)$/;
const DECORATION_REGEX = /(\[\d{1,2}:\d{2}(?::\d{2})?\])|(⏱\s*\d{1,2}:\d{2}(?::\d{2})?)|(（时间：\d{1,2}:\d{2}(?::\d{2})?）)|(\(\d{1,2}:\d{2}(?::\d{2})?\s*-\s*\d{1,2}:\d{2}(?::\d{2})?\))|(#[^\s#]+)|(==[^=]+==)|(\[证据\s*\d+(?:\s*[,，、]\s*\d+)*\])|(\[补充[·•.\-—]模型\])/g;

export interface MarkdownDecorationOptions {
  enableSeekTimestamps?: boolean;
  enableTimestampRanges?: boolean;
  enableHashtags?: boolean;
  searchQuery?: string;
  enableEvidenceCitations?: boolean;
  enableAutolinks?: boolean;
}

const URL_FIND_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`()[\]{}\uFF08\uFF09\u3010\u3011\u300A\u300B]+/gi;
const TRAILING_URL_PUNCT_RE = /[.,;:!?\u3002\uFF0C\uFF1B\uFF1A\uFF01\uFF1F\u3001]+$/;

export function normalizeExternalHref(raw: string): string | null {
  const core = raw.trim().replace(TRAILING_URL_PUNCT_RE, "");
  if (!core) return null;
  const href = /^www\./i.test(core) ? `https://${core}` : core;
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return href;
  } catch {
    return null;
  }
}

export function splitTextByUrls(text: string): Array<{ text: string; href?: string }> {
  const result: Array<{ text: string; href?: string }> = [];
  const matcher = new RegExp(URL_FIND_RE.source, URL_FIND_RE.flags);
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(text)) !== null) {
    const raw = match[0];
    const trailing = raw.match(TRAILING_URL_PUNCT_RE)?.[0] ?? "";
    const core = trailing ? raw.slice(0, -trailing.length) : raw;
    const href = normalizeExternalHref(core);
    if (match.index > lastIndex) {
      result.push({ text: text.slice(lastIndex, match.index) });
    }
    if (href) {
      result.push({ text: core, href });
      if (trailing) {
        result.push({ text: trailing });
      }
    } else {
      result.push({ text: raw });
    }
    lastIndex = match.index + raw.length;
  }

  if (lastIndex < text.length) {
    result.push({ text: text.slice(lastIndex) });
  }

  return result.length > 0 ? result : [{ text }];
}

function renderHighlightedAutolinks(
  text: string,
  options: MarkdownDecorationOptions,
  keyPrefix: string,
): React.ReactNode {
  if (options.enableAutolinks === false) {
    return highlightText(text, options.searchQuery, keyPrefix);
  }

  const parts = splitTextByUrls(text);
  if (parts.length === 1 && !parts[0]?.href) {
    return highlightText(text, options.searchQuery, keyPrefix);
  }

  return parts.map((part, index) => {
    const highlighted = highlightText(part.text, options.searchQuery, `${keyPrefix}-${index}`);
    if (!part.href) {
      return (
        <React.Fragment key={`${keyPrefix}-part-${index}`}>
          {highlighted}
        </React.Fragment>
      );
    }

    return (
      <a
        key={`${keyPrefix}-url-${index}`}
        href={part.href}
        target="_blank"
        rel="noreferrer"
        className="text-blue-500 dark:text-blue-400 hover:underline break-all"
        onClick={(event) => handleExternalLinkClick(event, part.href)}
      >
        {highlighted}
      </a>
    );
  });
}

export function parseTimestampToSeconds(value: string): number | null {
  const parts = value.trim().split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some(Number.isNaN)) {
    return null;
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

export function extractFirstTimestamp(text: string): number | null {
  const match = text.match(BRACKET_TIMESTAMP_RE)
    ?? text.match(CLOCK_TIMESTAMP_RE)
    ?? text.match(CHINESE_TIMESTAMP_RE);

  return match?.[1] ? parseTimestampToSeconds(match[1]) : null;
}

export function cleanMarkdownText(text: string): string {
  return text
    .replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, "")
    .replace(/⏱\s*\d{1,2}:\d{2}(?::\d{2})?/g, "")
    .replace(/（时间：\d{1,2}:\d{2}(?::\d{2})?）/g, "")
    .replace(/\(\d{1,2}:\d{2}(?::\d{2})?\s*-\s*\d{1,2}:\d{2}(?::\d{2})?\)/g, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~]+/g, "")
    .replace(/^\s+#+\s+/, "")
    .trim();
}

export function generateHeadingId(text: string, prefix: string = "heading"): string {
  const clean = text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fa5\-]+/g, "");

  return `${prefix}-${clean || "untitled"}`;
}

export function getTextFromReactNode(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return node.toString();
  if (Array.isArray(node)) return node.map(getTextFromReactNode).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return getTextFromReactNode(node.props.children);
  }
  return "";
}

export function buildUniqueHeadingId(
  children: React.ReactNode,
  prefix: string,
  slugCounts: Record<string, number>,
): string {
  const rawText = cleanMarkdownText(getTextFromReactNode(children));
  let id = generateHeadingId(rawText, prefix);

  if (slugCounts[id]) {
    slugCounts[id] += 1;
    id = `${id}-${slugCounts[id]}`;
  } else {
    slugCounts[id] = 1;
  }

  return id;
}

export function resolveMarkdownImageSrc(src: string, enableLocalImages: boolean): string {
  if (!enableLocalImages) {
    return src;
  }

  if (!/^[a-zA-Z]:[\\/]/.test(src) && !src.startsWith("\\\\")) {
    return src;
  }

  try {
    return convertFileSrc(src);
  } catch (error) {
    console.error("转换本地图片路径失败:", error);
    return src;
  }
}

function createSeekHandler(timeText: string) {
  return () => {
    const seekTime = parseTimestampToSeconds(timeText);
    if (seekTime === null) return;
    window.dispatchEvent(new CustomEvent("seek-video", { detail: { time: seekTime } }));
  };
}

function createRangeSeekHandler(rangeText: string) {
  const startTimeText = rangeText.match(TIMESTAMP_RANGE_RE)?.[1] ?? "";
  return createSeekHandler(startTimeText);
}

export function parseEvidenceRanks(citationToken: string): number[] {
  const inner = citationToken.replace(/^\[证据\s*/, "").replace(/\]$/, "");
  return inner
    .split(/[,，、]/)
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);
}

export function highlightText(text: string, query?: string, keyPrefix = "text"): React.ReactNode {
  if (!query?.trim()) {
    return text;
  }

  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);

  if (parts.length === 1) {
    return text;
  }

  return parts.map((part, index) => (
    index % 2 === 1 ? (
      <mark
        key={`${keyPrefix}-${index}`}
        className="bg-yellow-200 dark:bg-yellow-500/30 text-inherit rounded-sm px-0.5"
      >
        {part}
      </mark>
    ) : part
  ));
}

function renderDecoratedString(
  value: string,
  options: MarkdownDecorationOptions,
  keyPrefix: string,
): React.ReactNode {
  const result: React.ReactNode[] = [];
  let lastIndex = 0;
  let partIndex = 0;
  let match: RegExpExecArray | null;

  DECORATION_REGEX.lastIndex = 0;

  while ((match = DECORATION_REGEX.exec(value)) !== null) {
    if (match.index > lastIndex) {
      result.push(
        <React.Fragment key={`${keyPrefix}-text-${partIndex++}`}>
          {renderHighlightedAutolinks(value.slice(lastIndex, match.index), options, `${keyPrefix}-highlight-${partIndex}`)}
        </React.Fragment>,
      );
    }

    const matchedText = match[0];

    if (match[1] || match[2] || match[3]) {
      const timeText = match[1]
        ? matchedText.slice(1, -1)
        : matchedText.replace(/^⏱\s*/, "").replace(/^（时间：/, "").replace(/）$/, "");

      result.push(
        options.enableSeekTimestamps ? (
          <button
            key={`${keyPrefix}-timestamp-${partIndex++}`}
            type="button"
            className="timestamp cursor-pointer transition-opacity duration-200 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            onClick={createSeekHandler(timeText)}
          >
            {timeText}
          </button>
        ) : (
          <span key={`${keyPrefix}-timestamp-${partIndex++}`} className="timestamp">
            {timeText}
          </span>
        ),
      );
    } else if (match[4] && options.enableTimestampRanges !== false) {
      result.push(
        options.enableSeekTimestamps ? (
          <button
            key={`${keyPrefix}-range-${partIndex++}`}
            type="button"
            className="timestamp-range cursor-pointer transition-opacity duration-200 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            onClick={createRangeSeekHandler(matchedText)}
          >
            {matchedText}
          </button>
        ) : (
          <span key={`${keyPrefix}-range-${partIndex++}`} className="timestamp-range">
            {matchedText}
          </span>
        ),
      );
    } else if (match[5] && options.enableHashtags !== false) {
      result.push(
        <span
          key={`${keyPrefix}-tag-${partIndex++}`}
          className="markdown-tag inline-flex items-center px-2 py-0.5 mx-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
        >
          {matchedText}
        </span>,
      );
    } else if (match[6]) {
      // Obsidian-style highlight syntax: ==text==
      const highlightText_content = matchedText.slice(2, -2);
      result.push(
        <mark
          key={`${keyPrefix}-highlight-${partIndex++}`}
          className="bg-yellow-200 dark:bg-yellow-500/30 text-inherit px-0.5 rounded-sm"
        >
          {highlightText_content}
        </mark>,
      );
    } else if (match[7] && options.enableEvidenceCitations) {
      const ranks = parseEvidenceRanks(matchedText);
      ranks.forEach((rank, rankIndex) => {
        result.push(
          <EvidenceCitation
            key={`${keyPrefix}-citation-${partIndex}-${rankIndex}`}
            rank={rank}
          />,
        );
      });
      partIndex += 1;
    } else if (match[8]) {
      result.push(
        <span
          key={`${keyPrefix}-model-supplement-${partIndex++}`}
          className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded-md text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
          title="模型知识补充，非笔记原文"
        >
          补充·模型
        </span>,
      );
    } else {
      result.push(matchedText);
      partIndex += 1;
    }

    lastIndex = match.index + matchedText.length;
  }

  if (lastIndex < value.length) {
    result.push(
      <React.Fragment key={`${keyPrefix}-tail-${partIndex++}`}>
        {renderHighlightedAutolinks(value.slice(lastIndex), options, `${keyPrefix}-tail-highlight-${partIndex}`)}
      </React.Fragment>,
    );
  }

  if (result.length === 0) {
    return highlightText(value, options.searchQuery, `${keyPrefix}-plain`);
  }

  return result;
}

export function renderDecoratedReactNode(
  node: React.ReactNode,
  options: MarkdownDecorationOptions,
  keyPrefix = "node",
): React.ReactNode {
  if (typeof node === "string") {
    return renderDecoratedString(node, options, keyPrefix);
  }

  if (typeof node === "number") {
    return renderDecoratedString(String(node), options, keyPrefix);
  }

  if (Array.isArray(node)) {
    return node.map((child, index) => (
      <React.Fragment key={`${keyPrefix}-${index}`}>
        {renderDecoratedReactNode(child, options, `${keyPrefix}-${index}`)}
      </React.Fragment>
    ));
  }

  if (React.isValidElement<{ children?: React.ReactNode; href?: string; onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void; target?: string; rel?: string }>(node)) {
    if (node.type === "a") {
      return React.cloneElement(node, {
        ...node.props,
        target: node.props.target ?? "_blank",
        rel: node.props.rel ?? "noreferrer",
        onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
          handleExternalLinkClick(event, event.currentTarget.getAttribute("href") ?? node.props.href);
          node.props.onClick?.(event);
        },
        children: node.props.children
          ? renderDecoratedReactNode(node.props.children, { ...options, enableAutolinks: false }, `${keyPrefix}-child`)
          : node.props.children,
      });
    }

    if (!node.props.children) {
      return node;
    }

    return React.cloneElement(node, {
      ...node.props,
      children: renderDecoratedReactNode(node.props.children, options, `${keyPrefix}-child`),
    });
  }

  return node;
}
