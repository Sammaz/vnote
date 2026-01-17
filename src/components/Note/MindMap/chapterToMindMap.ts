/**
 * ChapterData 到 MindMap 数据格式转换工具
 *
 * 节点结构：
 * - 根节点（笔记标题）
 *   - 章节标题节点（带图片，图片作为视觉预览帮助快速识别章节）
 *     - 字幕内容节点（详细内容）
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import type { MindMapNode } from "simple-mind-map";
import type { ChapterData, Chapter, SubtitleEntry } from "../../../types";
import { getChapterSubtitles } from "../../../utils/markdownAssembler";

/**
 * 转换选项
 */
export interface ConvertOptions {
  /** 优化后的字幕 Map<chapterId, optimizedText> */
  optimizedSubtitles?: Map<string, string>;
  /** 原始字幕数据 */
  originalSubtitles?: SubtitleEntry[];
  /** 是否显示图片 */
  showImages?: boolean;
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
 * 获取章节的字幕内容（优先使用优化后的字幕）
 */
function getSubtitleContent(
  chapter: Chapter,
  optimizedSubtitles?: Map<string, string>,
  originalSubtitles?: SubtitleEntry[]
): string {
  // 优先使用优化后的字幕
  if (optimizedSubtitles?.has(chapter.id)) {
    return optimizedSubtitles.get(chapter.id) || "";
  }
  // 回退到原始字幕
  if (originalSubtitles && originalSubtitles.length > 0) {
    return getChapterSubtitles(chapter, originalSubtitles);
  }
  return "";
}

/**
 * 为章节创建标题节点（图片附加在标题节点上）
 * 结构：章节标题（带图片）→ 字幕内容
 *
 * 图片放在标题节点的原因：
 * - 标题是章节的"入口"，图片作为视觉预览帮助用户快速识别章节内容
 * - 结构更简洁，只有两层
 * - 符合思维导图"快速浏览定位"的使用习惯
 */
function createChapterNode(
  chapter: Chapter,
  options: ConvertOptions,
  additionalChildren: MindMapNode[] = []
): MindMapNode {
  const { optimizedSubtitles, originalSubtitles, showImages = true } = options;

  // 创建标题节点数据
  const nodeData: MindMapNode["data"] = {
    text: chapter.title,
    uid: chapter.id,
  };

  // 如果显示图片且有截图，将图片附加到标题节点
  if (showImages && chapter.screenshot_path) {
    try {
      const imageUrl = convertFileSrc(chapter.screenshot_path);
      nodeData.image = imageUrl;
      nodeData.imageTitle = chapter.title;
      // 图片宽度设置为 300px，占满卡片顶部，高度按 16:9 比例自动计算
      // custom: true 使图片尺寸不受主题控制，允许用户通过 NodeImgAdjust 插件调整大小
      nodeData.imageSize = { width: 300, height: 169, custom: true } as { width: number; height: number };
    } catch (error) {
      console.error(`[createChapterNode] 转换截图路径失败:`, error);
    }
  }

  // 获取字幕内容并创建子节点
  const children: MindMapNode[] = [];
  const subtitleContent = getSubtitleContent(chapter, optimizedSubtitles, originalSubtitles);
  if (subtitleContent.trim()) {
    children.push({
      data: {
        text: subtitleContent,
        uid: `${chapter.id}-subtitle`,
      },
      children: [],
    });
  }

  // 添加额外的子节点（如子章节）
  children.push(...additionalChildren);

  return {
    data: nodeData,
    children,
  };
}

/**
 * 递归构建 MindMap 节点
 * @param chapter 章节数据
 * @param tree 章节树
 * @param options 转换选项
 * @returns MindMap 节点
 */
function buildMindMapNode(
  chapter: Chapter,
  tree: Map<string | null, Chapter[]>,
  options: ConvertOptions
): MindMapNode {
  // 获取子章节
  const childChapters = tree.get(chapter.id) || [];

  // 递归构建子章节节点
  const childChapterNodes = childChapters.map((child) =>
    buildMindMapNode(child, tree, options)
  );

  // 创建章节节点（图片在标题上，字幕内容作为子节点）
  return createChapterNode(chapter, options, childChapterNodes);
}

/**
 * 将 ChapterData 转换为 MindMap 数据格式
 * 结构：根节点 → 章节标题（带图片）→ 字幕内容
 * @param chapterData 章节数据
 * @param rootTitle 根节点标题（笔记标题）
 * @param options 转换选项
 * @returns MindMap 节点数据
 */
export function convertChapterDataToMindMap(
  chapterData: ChapterData | null,
  rootTitle: string,
  options: ConvertOptions = {}
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
      buildMindMapNode(chapter, tree, options)
    );
  } else {
    // 无层级信息：所有章节作为根节点的直接子节点
    childNodes = chapters.map((chapter) =>
      createChapterNode(chapter, options)
    );
  }

  return {
    data: {
      text: rootTitle || "思维导图",
    },
    children: childNodes,
  };
}
