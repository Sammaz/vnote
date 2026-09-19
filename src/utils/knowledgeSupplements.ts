export interface KnowledgeSupplement {
  kind: "model" | "web";
  sentence: string;
  url?: string;
}

export function extractModelSupplements(content: string): KnowledgeSupplement[] {
  if (!content.trim()) return [];

  const marker = /\[补充[·•.\-—]模型\]/g;
  const results: KnowledgeSupplement[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = marker.exec(content)) !== null) {
    const sentence = takeLastSentence(content.slice(0, match.index));
    if (!sentence || seen.has(sentence)) continue;
    seen.add(sentence);
    results.push({ kind: "model", sentence });
  }

  return results;
}

function takeLastSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const lines = trimmed
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lastLine = lines[lines.length - 1] ?? "";
  const withoutList = lastLine
    .replace(/^[-*•]\s+/, "")
    .replace(/^\d+[\.、)]\s+/, "");
  const parts = withoutList
    .split(/(?<=[。！？!?；;])/)
    .map((part) => part.trim())
    .filter(Boolean);

  return (parts[parts.length - 1] ?? withoutList).trim();
}
