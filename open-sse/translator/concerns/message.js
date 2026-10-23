import { OPENAI_BLOCK } from "../schema/index.js";

// Collapse an OpenAI content-part array: text-only parts become one plain
// string (joined with newlines), any other shape is returned as-is. Matches
// the "text-only payloads must stay string-safe" contract the request
// translators rely on for providers that reject content arrays.
export function collapseTextParts(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return parts;
  const plainText = (part) =>
    part?.type === OPENAI_BLOCK.TEXT &&
    Object.keys(part).every((key) => key === "type" || key === "text");
  if (parts.every(plainText)) {
    return parts.map((part) => part.text ?? "").join("\n");
  }
  return parts;
}
