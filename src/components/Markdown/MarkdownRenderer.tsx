import { useMemo } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkCjkFriendly from "remark-cjk-friendly";
import type { Components } from "react-markdown";
import { cn } from "../../utils/cn";
import {
  buildUniqueHeadingId,
  renderDecoratedReactNode,
  resolveMarkdownImageSrc,
  type MarkdownDecorationOptions,
} from "../../utils/markdownRendererUtils";
import { MarkdownCodeBlock } from "./MarkdownCodeBlock";

interface MarkdownRendererProps extends MarkdownDecorationOptions {
  content: string;
  variant?: "note" | "chat" | "compact";
  className?: string;
  headingIdPrefix?: string;
  enableHeadingAnchors?: boolean;
  enableLocalImages?: boolean;
  centerImages?: boolean;
  interactiveTaskList?: boolean;
  checkedItems?: Set<number>;
  onToggleCheckbox?: (index: number) => void;
}

function getLanguage(className?: string): string | undefined {
  const match = className?.match(/language-([\w-]+)/);
  return match?.[1];
}

export function MarkdownRenderer({
  content,
  variant = "note",
  className,
  headingIdPrefix = "heading",
  enableHeadingAnchors = false,
  enableSeekTimestamps = false,
  enableTimestampRanges = true,
  enableHashtags = true,
  enableLocalImages = false,
  centerImages = false,
  interactiveTaskList = false,
  checkedItems,
  onToggleCheckbox,
  searchQuery,
  enableEvidenceCitations = false,
  citationSources,
  onCitationClick,
  activeCitationRank = null,
}: MarkdownRendererProps) {
  const baseClassName = variant === "chat"
    ? "chat-markdown"
    : variant === "compact"
      ? "note-markdown markdown-compact"
      : "note-markdown";

  const components = useMemo<Components>(() => {
    let checkboxIndex = 0;
    const slugCounts: Record<string, number> = {};

    const decorationOptions: MarkdownDecorationOptions = {
      enableSeekTimestamps,
      enableTimestampRanges,
      enableHashtags,
      searchQuery,
      enableEvidenceCitations,
      citationSources,
      onCitationClick,
      activeCitationRank,
    };

    const renderDecorated = (children: ReactNode, keyPrefix: string) =>
      renderDecoratedReactNode(children, decorationOptions, keyPrefix);

    const renderHeading = (tag: keyof Pick<Components, "h1" | "h2" | "h3" | "h4" | "h5" | "h6">) => ({ children }: { children?: ReactNode }) => {
      const Tag = tag as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      const id = enableHeadingAnchors
        ? buildUniqueHeadingId(children, headingIdPrefix, slugCounts)
        : undefined;

      return (
        <Tag id={id} style={id ? { scrollMarginTop: "100px" } : undefined} className={id ? "scroll-mt-24" : undefined}>
          {renderDecorated(children, `${Tag}-content`)}
        </Tag>
      );
    };

    return {
      input: ({ ...props }) => {
        if (props.type === "checkbox" && interactiveTaskList) {
          const currentIndex = checkboxIndex++;
          const isChecked = checkedItems?.has(currentIndex) ?? false;

          return (
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() => onToggleCheckbox?.(currentIndex)}
              className="cursor-pointer mr-2"
            />
          );
        }

        return <input {...props} />;
      },
      h1: renderHeading("h1"),
      h2: renderHeading("h2"),
      h3: renderHeading("h3"),
      h4: renderHeading("h4"),
      h5: renderHeading("h5"),
      h6: renderHeading("h6"),
      p: ({ children }) => <p>{renderDecorated(children, "p-content")}</p>,
      strong: ({ children }) => <strong>{renderDecorated(children, "strong-content")}</strong>,
      em: ({ children }) => <em>{renderDecorated(children, "em-content")}</em>,
      li: ({ children }) => <li>{renderDecorated(children, "li-content")}</li>,
      td: ({ children }) => <td>{renderDecorated(children, "td-content")}</td>,
      th: ({ children }) => <th>{renderDecorated(children, "th-content")}</th>,
      img: ({ src, alt, ...props }) => {
        if (!src) return null;
        const resolvedSrc = resolveMarkdownImageSrc(src, enableLocalImages);
        const image = (
          <img
            src={resolvedSrc}
            alt={alt || ""}
            {...props}
            className={cn(centerImages ? "rounded-lg max-w-full h-auto object-contain" : "max-w-full h-auto rounded-xl")}
            style={centerImages ? { maxHeight: "80vh" } : undefined}
          />
        );

        return centerImages ? (
          <span className="flex justify-center items-center w-full my-4">{image}</span>
        ) : image;
      },
      code: ({ className: codeClassName, children, ...props }) => {
        const rawCode = String(children);
        const code = rawCode.replace(/\n$/, "");
        const isInlineCode = !codeClassName && !rawCode.includes("\n");
        if (isInlineCode) {
          return (
            <code className={codeClassName} {...props}>
              {children}
            </code>
          );
        }

        return (
          <MarkdownCodeBlock
            code={code}
            language={getLanguage(codeClassName)}
            variant={variant}
          />
        );
      },
    };
  }, [
    checkedItems,
    enableHashtags,
    enableHeadingAnchors,
    enableLocalImages,
    enableSeekTimestamps,
    enableTimestampRanges,
    headingIdPrefix,
    interactiveTaskList,
    onToggleCheckbox,
    searchQuery,
    centerImages,
    variant,
    enableEvidenceCitations,
    citationSources,
    onCitationClick,
    activeCitationRank,
  ]);

  return (
    <div className={cn(baseClassName, className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
