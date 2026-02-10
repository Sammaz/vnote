/**
 * 将旧的 JSON 格式转换为 Markdown 格式
 */
export function convertJsonToMarkdown(content: string): string {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') return content;

    // 检查是否是旧的 FullSummaryData 格式
    if (parsed.abstract && parsed.highlights && Array.isArray(parsed.highlights)) {
      let md = "";

      // 摘要
      md += `# 摘要\n${parsed.abstract}\n\n`;

      // 亮点
      md += `# 核心亮点\n\n`;
      for (const item of parsed.highlights) {
        const emoji = item.emoji || '📌';
        md += `## ${emoji} ${item.title}\n${item.description}\n\n`;
      }

      // 问答
      if (parsed.qa_pairs && Array.isArray(parsed.qa_pairs) && parsed.qa_pairs.length > 0) {
        md += `# 疑问解答\n\n`;
        for (const pair of parsed.qa_pairs) {
          md += `**Q: ${pair.question}**\n\nA: ${pair.answer}\n\n`;
        }
      }

      // 思考
      if (parsed.thoughts && Array.isArray(parsed.thoughts) && parsed.thoughts.length > 0) {
        md += `# 思考\n\n`;
        for (const thought of parsed.thoughts) {
          md += `- ${thought}\n`;
        }
        md += `\n`;
      }

      // 术语表
      if (parsed.glossary && Array.isArray(parsed.glossary) && parsed.glossary.length > 0) {
        md += `# 关键术语\n\n`;
        for (const item of parsed.glossary) {
          md += `- **${item.term}**：${item.explanation}\n`;
        }
      }

      return md;
    }

    return content;
  } catch {
    return content;
  }
}
