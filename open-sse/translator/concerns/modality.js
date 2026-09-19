// Strip multimodal content blocks a model cannot read, BEFORE translation.
// Driven by getCapabilitiesForModel: vision/audioInput/pdf. Replaces removed
// media with a short text placeholder so messages never become empty.
import { FORMATS } from "../formats.js";

// Placeholder text inserted where a media block was removed.
// Current turn: explain the active model can't read what the user just sent.
const PLACEHOLDER_CURRENT = {
  vision: "[image omitted: model has no vision support]",
  audioInput: "[audio omitted: model has no audio support]",
  pdf: "[file omitted: model has no document support]",
};
// Earlier turns: neutral (a combo may route to a different model each turn).
const PLACEHOLDER_PREV = {
  vision: "[Previous image omitted from context.]",
  audioInput: "[Previous audio omitted from context.]",
  pdf: "[Previous file omitted from context.]",
};
const ph = (cap, isLast, noMedia) =>
  noMedia ? PLACEHOLDER_NOMEDIA[cap] : (isLast ? PLACEHOLDER_CURRENT : PLACEHOLDER_PREV)[cap];

// No-media mode (Token Saver toggle): every provider drops ALL media/files,
// even when the model declares support — some free-tier upstreams answer
// media payloads with a bare 400.
const PLACEHOLDER_NOMEDIA = {
  vision: "[image omitted: no-media mode]",
  audioInput: "[audio omitted: no-media mode]",
  pdf: "[file omitted: no-media mode]",
  videoInput: "[video omitted: no-media mode]",
};
// Fallback when a dropped blob fits no known category, or a message would
// otherwise be left with zero content (most upstreams 400 on that too).
const PLACEHOLDER_GENERIC_NOMEDIA = "[media omitted: no-media mode]";

// Map gemini inlineData/fileData mime prefix -> capability it requires.
// Video is only mapped in no-media mode: outside it, video parts keep the
// legacy pass-through so models whose caps under-declare video are untouched.
function capForMime(mime, noMedia = false) {
  if (typeof mime !== "string") return null;
  if (mime.startsWith("image/")) return "vision";
  if (mime.startsWith("audio/")) return "audioInput";
  if (mime === "application/pdf") return "pdf";
  if (noMedia && mime.startsWith("video/")) return "videoInput";
  return null;
}

// OpenAI chat content block -> required capability (null = plain text/other, keep).
function capForOpenAIBlock(block) {
  const t = block?.type;
  if (t === "image_url" || t === "image") return "vision";
  if (t === "input_audio" || t === "audio_url") return "audioInput";
  if (t === "file") return "pdf";
  return null;
}

// Claude content block -> required capability.
function capForClaudeBlock(block) {
  const t = block?.type;
  if (t === "image") return "vision";
  if (t === "document") return "pdf";
  return null;
}

// Filter an array of content blocks; drop unsupported, inject one placeholder per kind.
// isLast = block belongs to the current user turn (picks the explanatory placeholder).
// noMedia = use the no-media placeholder wording instead.
function filterBlocks(blocks, capOf, caps, removed, isLast, noMedia = false) {
  const out = [];
  for (const block of blocks) {
    const cap = capOf(block);
    if (cap && caps[cap] === false) { removed.add(cap); continue; }
    out.push(block);
  }
  for (const cap of removed) out.push({ type: "text", text: ph(cap, isLast, noMedia) });
  return out;
}

// OpenAI / OpenAI-compatible chat messages[].content[].
function stripOpenAI(body, caps, noMedia = false) {
  if (!Array.isArray(body.messages)) return;
  const last = body.messages.length - 1;
  body.messages.forEach((msg, i) => {
    if (caps.vision === false) {
      if (Array.isArray(msg.images)) delete msg.images;
      if (Array.isArray(msg.experimental_attachments)) {
        msg.experimental_attachments = msg.experimental_attachments.filter(
          (a) => !(a?.contentType?.startsWith("image/") || (typeof a?.url === "string" && a.url.startsWith("data:image/")))
        );
      }
      if (Array.isArray(msg.attachments)) {
        msg.attachments = msg.attachments.filter(
          (a) => !(a?.contentType?.startsWith("image/") || (typeof a?.url === "string" && a.url.startsWith("data:image/")))
        );
      }
    }
    // No-media drops every attachment outright, not just images.
    if (noMedia) {
      if (Array.isArray(msg.images)) delete msg.images;
      if (Array.isArray(msg.experimental_attachments)) msg.experimental_attachments = [];
      if (Array.isArray(msg.attachments)) msg.attachments = [];
    }
    if (!Array.isArray(msg.content)) return;
    const removed = new Set();
    msg.content = filterBlocks(msg.content, capForOpenAIBlock, caps, removed, i === last, noMedia);
    if (msg.content.length === 0 && removed.size > 0) {
      msg.content.push({ type: "text", text: PLACEHOLDER_GENERIC_NOMEDIA });
    }
  });
}

// Claude messages[].content[].
function stripClaude(body, caps, noMedia = false) {
  if (!Array.isArray(body.messages)) return;
  const last = body.messages.length - 1;
  body.messages.forEach((msg, i) => {
    if (!Array.isArray(msg.content)) return;
    const removed = new Set();
    msg.content = filterBlocks(msg.content, capForClaudeBlock, caps, removed, i === last, noMedia);
    if (msg.content.length === 0 && removed.size > 0) {
      msg.content.push({ type: "text", text: PLACEHOLDER_GENERIC_NOMEDIA });
    }
  });
}

// OpenAI Responses input[].content[] (input_image / input_file / input_audio).
function stripResponses(body, caps, noMedia = false) {
  if (!Array.isArray(body.input)) return;
  const last = body.input.length - 1;
  body.input.forEach((item, i) => {
    if (!Array.isArray(item.content)) return;
    const removed = new Set();
    item.content = item.content.filter((b) => {
      let cap = b?.type === "input_image" ? "vision" : b?.type === "input_file" ? "pdf" : null;
      // input_audio has no caps-gated mapping outside no-media mode.
      if (!cap && noMedia && b?.type === "input_audio") cap = "audioInput";
      if (cap && caps[cap] === false) { removed.add(cap); return false; }
      return true;
    });
    for (const cap of removed) item.content.push({ type: "input_text", text: ph(cap, i === last, noMedia) });
    if (item.content.length === 0 && removed.size > 0) {
      item.content.push({ type: "input_text", text: PLACEHOLDER_GENERIC_NOMEDIA });
    }
  });
}

// Gemini / gemini-cli contents[].parts[] (inlineData / fileData by mime).
function stripGeminiParts(contents, caps, noMedia = false) {
  if (!Array.isArray(contents)) return;
  const last = contents.length - 1;
  contents.forEach((c, i) => {
    if (!Array.isArray(c.parts)) return;
    const removed = new Set();
    let droppedOther = false;
    c.parts = c.parts.filter((p) => {
      const hasBlob = !!(p?.inlineData || p?.fileData);
      const mime = p?.inlineData?.mimeType || p?.fileData?.mimeType;
      const cap = capForMime(mime, noMedia);
      if (cap && caps[cap] === false) { removed.add(cap); return false; }
      // No-media drops every binary part, even with an unmapped mime
      // (application/octet-stream, text/csv, ...) — none of it is text.
      if (noMedia && hasBlob) { droppedOther = true; return false; }
      return true;
    });
    for (const cap of removed) c.parts.push({ text: ph(cap, i === last, noMedia) });
    if (droppedOther) c.parts.push({ text: PLACEHOLDER_GENERIC_NOMEDIA });
    if (c.parts.length === 0 && (removed.size > 0 || droppedOther)) {
      c.parts.push({ text: PLACEHOLDER_GENERIC_NOMEDIA });
    }
  });
}

/**
 * Remove media blocks the model can't read, in-place on the source-format body.
 * @param {object} body - request body (source format)
 * @param {string} sourceFormat - one of FORMATS
 * @param {object} caps - capabilities from getCapabilitiesForModel
 * @param {object} [options] - { noMedia: true } drops ALL media/files for every
 *   provider (Token Saver toggle), ignoring declared support; also strips video
 *   and unmapped binary parts, which the capability-driven path leaves alone.
 * @returns {boolean} true if anything was stripped-eligible (cap false for some modality)
 */
export function stripUnsupportedModalities(body, sourceFormat, caps, options = {}) {
  const noMedia = options?.noMedia === true;
  // No-media forces every modality off, including videoInput (which the
  // capability path never strips on its own).
  const eff = noMedia && caps
    ? { ...caps, vision: false, audioInput: false, pdf: false, videoInput: false }
    : caps;
  if (!body || !eff) return false;
  // Fast exit: model supports everything we'd strip.
  if (!noMedia && eff.vision !== false && eff.audioInput !== false && eff.pdf !== false) return false;

  switch (sourceFormat) {
    case FORMATS.OPENAI:
    case FORMATS.OLLAMA:
    case FORMATS.KIRO:
    case FORMATS.CURSOR:
    case FORMATS.COMMANDCODE:
      stripOpenAI(body, eff, noMedia);
      break;
    case FORMATS.CLAUDE:
      stripClaude(body, eff, noMedia);
      break;
    case FORMATS.OPENAI_RESPONSES:
    case FORMATS.OPENAI_RESPONSE:
    case FORMATS.CODEX:
      stripResponses(body, eff, noMedia);
      break;
    case FORMATS.GEMINI:
    case FORMATS.GEMINI_CLI:
    case FORMATS.VERTEX:
      stripGeminiParts(body.contents, eff, noMedia);
      break;
    case FORMATS.ANTIGRAVITY:
      stripGeminiParts(body?.request?.contents, eff, noMedia);
      break;
    default:
      stripOpenAI(body, eff, noMedia);
  }
  return true;
}
