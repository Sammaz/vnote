/**
 * ChapterData 到 MindMap 数据格式转换工具
 */

import type { MindMapNode } from "simple-mind-map";
import type { ChapterData, Chapter } from "../../../types";

/**
 * 格式化时间戳为 HH:MM:SS 格式
 */
function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/**
 * 构建层级结构的章节树
 * @param chapters 章节数组
 * @returns 层级结构的章节树
 */
function buildChapterTree(chapters: Chapter[]): Map<string | null, Chapter[]> {
  const tree = new Map<string | null, Chapter[]>();

  for (const chapter of chapters) {
    const parentId = chapter.parent_id ?? null;
    if (!tree.has(parentId)) {
      tree.set(parentId, []);
    }
    tree.get(parentId)!.push(chapter);
  }

  return tree;
}

/**
 * 递归构建 MindMap 节点
 * @param chapter 章节数据
 * @param tree 章节树
 * @returns MindMap 节点
 */
function buildMindMapNode(
  chapter: Chapter,
  tree: Map<string | null, Chapter[]>
): MindMapNode {
  const timestamp = formatTimestamp(chapter.start_time);
  const children = tree.get(chapter.id) || [];

  const node: MindMapNode = {
    data: {
      text: chapter.title,
      uid: chapter.id,
    },
    children: children.map((child) => buildMindMapNode(child, tree)),
  };

  return node;
}

/**
 * 将 ChapterData 转换为 MindMap 数据格式
 * @param chapterData 章节数据
 * @param rootTitle 根节点标题（笔记标题）
 * @returns MindMap 节点数据
 */
export function convertChapterDataToMindMap(
  chapterData: ChapterData | null,
  rootTitle: string
): MindMapNode {
  // 空数据时返回只有根节点的结构
  if (!chapterData || chapterData.chapters.length === 0) {
    return {
      data: {
        text: rootTitle || "思维导图",
      },
      children: [],
    };
  }

  const { chapters } = chapterData;

  // 检查是否有层级信息
  const hasHierarchy = chapters.some(
    (ch) => ch.level !== undefined || ch.parent_id !== undefined
  );

  let childNodes: MindMapNode[];

  if (hasHierarchy) {
    // 有层级信息：构建层级树
    const tree = buildChapterTree(chapters);
    const rootChapters = tree.get(null) || [];

    childNodes = rootChapters.map((chapter) =>
      buildMindMapNode(chapter, tree)
    );
  } else {
    // 无层级信息：所有章节作为根节点的直接子节点
    childNodes = chapters.map((chapter) => {
      return {
        data: {
          text: chapter.title,
          uid: chapter.id,
        },
        children: [],
      };
    });
  }

  return {
    data: {
      text: rootTitle || "思维导图",
    },
    children: childNodes,
  };
}
