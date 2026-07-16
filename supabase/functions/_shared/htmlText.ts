// supabase/functions/_shared/htmlText.ts
// Dependency-free HTML → plain text for the guideline ingestion pipeline.
// The output is cached to Storage and later embedded in LLM prompts, so
// structure fidelity matters less than dropping scripts/nav noise.

const BLOCK_DROP_RE = /<(script|style|noscript|nav|header|footer|iframe|svg)\b[\s\S]*?<\/\1>/gi;
const BLOCK_BREAK_RE = /<\/(p|div|li|tr|h[1-6]|section|article|blockquote)>|<br\s*\/?>/gi;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

export function htmlToText(html: string, maxChars = 500_000): string {
  let text = html
    .replace(BLOCK_DROP_RE, " ")
    .replace(BLOCK_BREAK_RE, "\n")
    .replace(/<[^>]+>/g, " ");

  for (const [entity, char] of Object.entries(ENTITIES)) {
    text = text.replaceAll(entity, char);
  }
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

  return text
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars);
}
