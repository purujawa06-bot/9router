import { describe, it, expect } from "vitest";
import {
  isMeaningfulTranslatedItem,
  isEmptyNonStreamingBody,
  peekUpstreamForContent,
  isBinaryContentType,
} from "../../open-sse/handlers/chatCore/emptyStreamGuard.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

function sseResponse(lines, contentType = "text/event-stream") {
  const text = lines.join("\n");
  return new Response(text, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

const OPENAI = FORMATS.OPENAI;

describe("isMeaningfulTranslatedItem (OpenAI client)", () => {
  it("treats role-only and finish-only chunks as NOT meaningful", () => {
    expect(
      isMeaningfulTranslatedItem({ choices: [{ delta: { role: "assistant" } }] }, OPENAI)
    ).toBe(false);
    expect(
      isMeaningfulTranslatedItem({ choices: [{ delta: {}, finish_reason: "stop" }] }, OPENAI)
    ).toBe(false);
  });

  it("treats text, reasoning, and tool_calls as meaningful", () => {
    expect(
      isMeaningfulTranslatedItem({ choices: [{ delta: { content: "hi" } }] }, OPENAI)
    ).toBe(true);
    expect(
      isMeaningfulTranslatedItem({ choices: [{ delta: { reasoning_content: "think" } }] }, OPENAI)
    ).toBe(true);
    expect(
      isMeaningfulTranslatedItem({
        choices: [{ delta: { tool_calls: [{ id: "c1", function: { name: "read", arguments: "{}" } }] } }],
      }, OPENAI)
    ).toBe(true);
  });
});

describe("isEmptyNonStreamingBody", () => {
  it("flags finish-stop with no content/tool calls as empty", () => {
    expect(
      isEmptyNonStreamingBody({
        choices: [{ message: { role: "assistant", content: "" }, finish_reason: "stop" }],
      }, OPENAI)
    ).toBe(true);
    expect(
      isEmptyNonStreamingBody({
        choices: [{ message: { role: "assistant", content: null }, finish_reason: "stop" }],
      }, OPENAI)
    ).toBe(true);
  });

  it("passes bodies with content, reasoning, or tool calls", () => {
    expect(
      isEmptyNonStreamingBody({
        choices: [{ message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
      }, OPENAI)
    ).toBe(false);
    expect(
      isEmptyNonStreamingBody({
        choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "1" }] }, finish_reason: "tool_calls" }],
      }, OPENAI)
    ).toBe(false);
    expect(
      isEmptyNonStreamingBody({
        choices: [{ message: { role: "assistant", content: "", reasoning_content: "r" }, finish_reason: "stop" }],
      }, OPENAI)
    ).toBe(false);
  });
});

describe("peekUpstreamForContent", () => {
  it("reports empty for a bare [DONE] stream (passthrough)", async () => {
    const res = sseResponse(["data: [DONE]", ""]);
    const out = await peekUpstreamForContent(res, {
      targetFormat: OPENAI, sourceFormat: OPENAI,
    });
    expect(out.empty).toBe(true);
  });

  it("reports empty for finish-stop with no content (passthrough)", async () => {
    const res = sseResponse([
      `data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}`,
      ``,
      `data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
      ``,
      "data: [DONE]",
      "",
    ]);
    const out = await peekUpstreamForContent(res, {
      targetFormat: OPENAI, sourceFormat: OPENAI,
    });
    expect(out.empty).toBe(true);
  });

  it("reports non-empty for content and replays the full byte stream", async () => {
    const lines = [
      `data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}`,
      ``,
      `data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":null}]}`,
      ``,
      `data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
      ``,
      "data: [DONE]",
      "",
    ];
    const res = sseResponse(lines);
    const out = await peekUpstreamForContent(res, {
      targetFormat: OPENAI, sourceFormat: OPENAI,
    });
    expect(out.empty).toBe(false);
    const text = await out.response.text();
    expect(text).toBe(lines.join("\n"));
  });

  it("reports non-empty for tool_calls-only streams", async () => {
    const res = sseResponse([
      `data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read","arguments":"{}"}}]},"finish_reason":null}]}`,
      ``,
      "data: [DONE]",
      "",
    ]);
    const out = await peekUpstreamForContent(res, {
      targetFormat: OPENAI, sourceFormat: OPENAI,
    });
    expect(out.empty).toBe(false);
  });

  it("detects content through translation (gemini upstream → openai client)", async () => {
    const res = sseResponse([
      `data: {"candidates":[{"content":{"role":"model","parts":[{"text":"halo"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1,"totalTokenCount":2},"modelVersion":"gemini","responseId":"r1"}`,
      ``,
      "data: [DONE]",
      "",
    ]);
    const out = await peekUpstreamForContent(res, {
      targetFormat: FORMATS.GEMINI, sourceFormat: OPENAI,
    });
    expect(out.empty).toBe(false);
  });

  it("reports empty when translation yields nothing (gemini empty parts)", async () => {
    const res = sseResponse([
      `data: {"candidates":[{"content":{"role":"model","parts":[]},"finishReason":"STOP"}],"modelVersion":"gemini","responseId":"r1"}`,
      ``,
      "data: [DONE]",
      "",
    ]);
    const out = await peekUpstreamForContent(res, {
      targetFormat: FORMATS.GEMINI, sourceFormat: OPENAI,
    });
    expect(out.empty).toBe(true);
  });
});

describe("isBinaryContentType", () => {
  it("skips binary upstreams", () => {
    expect(isBinaryContentType("application/octet-stream")).toBe(true);
    expect(isBinaryContentType("text/event-stream")).toBe(false);
    expect(isBinaryContentType("")).toBe(false);
  });
});
