import { OPENAI_BLOCK } from "../schema/index.js";

// Collapse an OpenAI content-part array: text-only parts become one plain
// string (joined with newlines), any other shape is returned as-is. Cache-aware
// targets retain marked blocks when requested.
export function collapseTextParts(parts, opts = {}) {
  if (!Array.isArray(parts) || parts.length === 0) return parts;
  const plainText = (part) =>
    part?.type === OPENAI_BLOCK.TEXT &&
    Object.keys(part).every((key) => key === "type" || key === "text");

  if (parts.every(plainText)) {
    if (opts.preserveCacheControl && parts.some((part) => part?.cache_control)) {
      return parts;
    }
    return parts.map((part) => part.text ?? "").join("\n");
  }

  if (
    parts.length === 1 &&
    parts[0]?.type === OPENAI_BLOCK.TEXT &&
    !(opts.preserveCacheControl && parts[0]?.cache_control)
  ) {
    return parts[0].text ?? "";
  }

  return parts;
}
