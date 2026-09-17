import { FORMATS } from "../../translator/formats.js";
import { translateResponse, initState, needsTranslation } from "../../translator/index.js";
import { parseSSELine } from "../../utils/streamHelpers.js";
import { getOpenAIResponsesEventName } from "../../utils/responsesStreamHelpers.js";

// Binary / non-text SSE upstreams (kiro EventStream, cursor protobuf,
// commandcode NDJSON-over-binary, etc.) are not SSE-text — the peek logic
// below only understands `data:` SSE lines, so skip the guard for them.
const BINARY_CONTENT_TYPES = [
  "application/octet-stream",
  "application/x-protobuf",
  "application/protobuf",
  "application/vnd.google.protobuf",
  "application/x-amz-json",
  "application/x-amzn-json",
];

export function isBinaryContentType(contentType) {
  const ct = String(contentType || "").toLowerCase();
  if (!ct) return false;
  return BINARY_CONTENT_TYPES.some((b) => ct.includes(b));
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.length > 0;
}

// Strict "did the client see anything useful" check. Deliberately stricter
// than hasValuableContent(): role-only deltas and bare finish_reason chunks
// do NOT count — an upstream that streams `finish_reason: stop` with no
// content and no tool_calls is exactly the empty-response case.
export function isMeaningfulTranslatedItem(item, sourceFormat) {
  if (!item || typeof item !== "object") return false;

  // OpenAI chat chunk (also the shape every translator normalizes into)
  const delta = item.choices?.[0]?.delta;
  if (delta && typeof delta === "object") {
    if (isNonEmptyString(delta.content)) return true;
    if (isNonEmptyString(delta.reasoning_content)) return true;
    if (isNonEmptyString(delta.reasoning)) return true;
    if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
      // A single tool_call entry with at least a name, id, or argument
      // fragment counts — streaming reassembles these downstream.
      for (const tc of delta.tool_calls) {
        const fn = tc?.function || {};
        if (tc?.id || fn?.name || isNonEmptyString(fn?.arguments)) return true;
      }
      return true;
    }
    return false;
  }

  // Claude SSE (client speaks Claude)
  if (sourceFormat === FORMATS.CLAUDE) {
    if (item.type === "content_block_delta") {
      if (isNonEmptyString(item.delta?.text)) return true;
      if (isNonEmptyString(item.delta?.thinking)) return true;
      if (isNonEmptyString(item.delta?.partial_json)) return true;
      return false;
    }
    if (item.type === "content_block_start" && item.content_block?.type === "tool_use") return true;
    return false;
  }

  // Responses API same-format passthrough { event, data }
  if (item.event && item.data && typeof item.data === "object") {
    const d = item.data;
    if (isNonEmptyString(d.delta)) return true;
    if (isNonEmptyString(d.text)) return true;
    if (isNonEmptyString(d.arguments)) return true;
    if (isNonEmptyString(d.input)) return true;
    // output_item.added for message/function_call carries the item payload
    if (d.item && typeof d.item === "object") {
      const c = d.item.content;
      if (Array.isArray(c)) {
        for (const b of c) {
          if (isNonEmptyString(b?.text)) return true;
        }
      }
      if (isNonEmptyString(d.item.arguments)) return true;
      if (isNonEmptyString(d.item.input)) return true;
      if (d.item.type === "function_call" || d.item.type === "custom_tool_call") return true;
      if (d.item.type === "message") return false; // empty shell, wait for deltas
    }
    return false;
  }

  // Gemini passthrough shapes / unknown: look for any text part
  if (Array.isArray(item.candidates)) {
    for (const cand of item.candidates) {
      const parts = cand?.content?.parts;
      if (Array.isArray(parts)) {
        for (const p of parts) {
          if (isNonEmptyString(p?.text)) return true;
          if (p?.functionCall) return true;
        }
      }
    }
    return false;
  }

  return false;
}

function buildProbeState({ sourceFormat, provider, model, toolNameMap, customToolNames, sessionId }) {
  return {
    ...initState(sourceFormat),
    provider,
    model,
    toolNameMap: toolNameMap || null,
    customToolNames: new Set(customToolNames || []),
    sessionId: sessionId || null,
  };
}

// Peek the upstream SSE body until the first client-meaningful chunk arrives
// (or EOF). On success the consumed bytes are replayed in front of the live
// remainder so downstream streaming still works — only TTFT slips by the time
// to first meaningful token. On empty, the caller should treat the upstream
// as a 502-class failure so account/combo fallback triggers.
//
// Returns { empty: true } or { empty: false, response: Response }.
export async function peekUpstreamForContent(providerResponse, opts = {}) {
  const {
    targetFormat,
    sourceFormat,
    toolNameMap = null,
    customToolNames = null,
    provider = null,
    model = null,
    sessionId = null,
  } = opts;

  const body = providerResponse?.body;
  if (!body || typeof body.getReader !== "function") {
    return { empty: true };
  }

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const buffered = [];
  let textBuf = "";
  let currentEvent = null;
  const probeState = buildProbeState({ sourceFormat, provider, model, toolNameMap, customToolNames, sessionId });
  const translate = needsTranslation(targetFormat, sourceFormat);
  const isResponsesUpstream = targetFormat === FORMATS.OPENAI_RESPONSES;

  const checkLine = (trimmed) => {
    if (!trimmed) return false;
    if (trimmed.startsWith("event:")) {
      currentEvent = trimmed.slice(6).trim();
      return false;
    }
    const parsed = parseSSELine(trimmed, targetFormat);
    if (!parsed) return false;
    // SSE sentinel — not content. Ollama's done:true IS the final chunk,
    // but it carries finish_reason/usage, never content, so it can't make
    // an otherwise-empty stream meaningful either.
    if (parsed.done) return false;

    let items;
    try {
      if (isResponsesUpstream && sourceFormat === FORMATS.OPENAI_RESPONSES) {
        // Same-format passthrough keeps { event, data } framing; resolve the
        // event name the same way stream.js does before judging.
        const evt = getOpenAIResponsesEventName(currentEvent, parsed);
        items = [{ event: evt, data: parsed }];
        currentEvent = null;
      } else if (translate) {
        items = translateResponse(targetFormat, sourceFormat, parsed, probeState);
      } else {
        items = [parsed];
      }
    } catch {
      return false;
    }
    if (!Array.isArray(items)) return false;
    for (const it of items) {
      if (isMeaningfulTranslatedItem(it, sourceFormat)) return true;
    }
    return false;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) buffered.push(value);
      if (done) {
        // Trailing bytes without a closing newline still count.
        try {
          const tail = decoder.decode();
          if (tail) textBuf += tail;
        } catch { /* ignore */ }
        if (textBuf.trim() && checkLine(textBuf.trim())) {
          break;
        }
        // Flush translators the way stream.js does: a final `translate(...,
        // null, state)` can emit close events — but those are lifecycle, not
        // content, so only re-check translated output for meaningful items.
        if (translate && !isResponsesUpstream) {
          try {
            const flushed = translateResponse(targetFormat, sourceFormat, null, probeState);
            if (Array.isArray(flushed)) {
              for (const it of flushed) {
                if (isMeaningfulTranslatedItem(it, sourceFormat)) {
                  return replay(buffered, reader, providerResponse);
                }
              }
            }
          } catch { /* probe must never throw */ }
        }
        try { await reader.cancel(); } catch { /* already closed */ }
        return { empty: true };
      }
      textBuf += decoder.decode(value, { stream: true });
      const lines = textBuf.split("\n");
      textBuf = lines.pop() || "";
      let found = false;
      for (const line of lines) {
        if (checkLine(line.trim())) { found = true; break; }
      }
      if (found) break;
    }
  } catch {
    // Read error mid-peek: if we already saw content, replay what we have;
    // otherwise report empty so the caller falls through to the next model.
    try { await reader.cancel(); } catch { /* ignore */ }
    return { empty: true };
  }

  return replay(buffered, reader, providerResponse);
}

function replay(buffered, reader, providerResponse) {
  const replayStream = new ReadableStream({
    start(controller) {
      for (const chunk of buffered) controller.enqueue(chunk);
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (e) {
        controller.error(e);
      }
    },
    cancel(reason) {
      try { reader.cancel(reason); } catch { /* ignore */ }
    },
  });
  const headers = new Headers();
  try {
    providerResponse.headers.forEach((v, k) => headers.set(k, v));
  } catch { /* ignore */ }
  return {
    empty: false,
    response: new Response(replayStream, {
      status: providerResponse.status,
      statusText: providerResponse.statusText,
      headers,
    }),
  };
}

// Non-streaming counterpart: a 200 JSON body with no text, no reasoning and
// no tool calls is the same failure mode. Returns true when the translated
// client-facing body is empty.
export function isEmptyNonStreamingBody(translatedResponse, sourceFormat) {
  const r = translatedResponse;
  if (!r || typeof r !== "object") return true;

  // OpenAI chat completion
  const choice = r.choices?.[0];
  if (choice) {
    const msg = choice.message || {};
    if (isNonEmptyString(msg.content)) return false;
    if (isNonEmptyString(msg.reasoning_content)) return false;
    if (isNonEmptyString(msg.reasoning)) return false;
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) return false;
    return true;
  }

  // Claude message
  if (sourceFormat === FORMATS.CLAUDE && r.type === "message" && Array.isArray(r.content)) {
    for (const b of r.content) {
      if (b?.type === "text" && isNonEmptyString(b.text)) return false;
      if (b?.type === "thinking" && isNonEmptyString(b.thinking)) return false;
      if (b?.type === "tool_use") return false;
    }
    return true;
  }

  // Responses API object
  if (r.object === "response" && Array.isArray(r.output)) {
    for (const item of r.output) {
      if (item?.type === "message" && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (isNonEmptyString(c?.text)) return false;
        }
      }
      if (item?.type === "function_call" || item?.type === "custom_tool_call") return false;
      if (item?.type === "reasoning" && Array.isArray(item.summary)) {
        for (const s of item.summary) {
          if (isNonEmptyString(s?.text)) return false;
        }
      }
    }
    return true;
  }

  return false;
}
