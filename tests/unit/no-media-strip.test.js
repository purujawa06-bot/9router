import { describe, it, expect } from "vitest";
import { stripUnsupportedModalities } from "../../open-sse/translator/concerns/modality.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Full-support caps: without the flag nothing may be touched.
const ALL = { vision: true, audioInput: true, pdf: true, videoInput: true };

describe("stripUnsupportedModalities — no-media mode", () => {
  it("fast-exits untouched without the flag, even with media present", () => {
    const body = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "x" } }] }] };
    expect(stripUnsupportedModalities(body, FORMATS.OPENAI, ALL)).toBe(false);
    expect(body.messages[0].content).toHaveLength(1);
  });

  it("openai: strips image + audio + file, keeps text, no-media placeholders", () => {
    const body = { messages: [{ role: "user", content: [
      { type: "text", text: "look" },
      { type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
      { type: "input_audio", input_audio: { data: "x", format: "wav" } },
      { type: "file", file: { filename: "d.pdf", file_data: "data:application/pdf;base64,x" } },
    ] }] };
    expect(stripUnsupportedModalities(body, FORMATS.OPENAI, ALL, { noMedia: true })).toBe(true);
    const content = body.messages[0].content;
    expect(content.some((b) => b.type === "text" && b.text === "look")).toBe(true);
    expect(content.some((b) => b.type === "image_url")).toBe(false);
    expect(content.some((b) => b.type === "input_audio")).toBe(false);
    expect(content.some((b) => b.type === "file")).toBe(false);
    expect(content.some((b) => /no-media mode/.test(b.text || ""))).toBe(true);
  });

  it("openai: image-only message is not left empty", () => {
    const body = { messages: [{ role: "user", content: [
      { type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
    ] }] };
    stripUnsupportedModalities(body, FORMATS.OPENAI, ALL, { noMedia: true });
    expect(body.messages[0].content.length).toBeGreaterThan(0);
    expect(body.messages[0].content.every((b) => b.type === "text")).toBe(true);
  });

  it("openai: drops attachments arrays in no-media mode", () => {
    const body = { messages: [{ role: "user", content: [{ type: "text", text: "hi" }],
      images: ["data:image/png;base64,x"],
      attachments: [{ contentType: "application/pdf", url: "http://x/y.pdf" }],
    }] };
    stripUnsupportedModalities(body, FORMATS.OPENAI, ALL, { noMedia: true });
    expect(body.messages[0].images).toBeUndefined();
    expect(body.messages[0].attachments).toEqual([]);
  });

  it("responses: strips input_image + input_file + input_audio", () => {
    const body = { input: [{ type: "message", role: "user", content: [
      { type: "input_text", text: "hi" },
      { type: "input_image", image_url: "data:image/png;base64,x" },
      { type: "input_file", filename: "a.pdf" },
      { type: "input_audio", input_audio: { data: "x", format: "wav" } },
    ] }] };
    stripUnsupportedModalities(body, FORMATS.OPENAI_RESPONSES, ALL, { noMedia: true });
    const types = body.input[0].content.map((b) => b.type);
    expect(types).toContain("input_text");
    expect(types).not.toContain("input_image");
    expect(types).not.toContain("input_file");
    expect(types).not.toContain("input_audio");
  });

  it("claude: strips image + document", () => {
    const body = { messages: [{ role: "user", content: [
      { type: "text", text: "hi" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "x" } },
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "x" } },
    ] }] };
    stripUnsupportedModalities(body, FORMATS.CLAUDE, ALL, { noMedia: true });
    const types = body.messages[0].content.map((b) => b.type);
    expect(types).not.toContain("image");
    expect(types).not.toContain("document");
    expect(types).toContain("text");
  });

  it("gemini: strips image + video + unmapped blobs, keeps text + functionCall", () => {
    const body = { contents: [{ role: "user", parts: [
      { text: "hi" },
      { inlineData: { mimeType: "image/png", data: "x" } },
      { fileData: { mimeType: "video/mp4", fileUri: "http://x/v.mp4" } },
      { inlineData: { mimeType: "application/octet-stream", data: "y" } },
      { functionCall: { name: "f", args: {} } },
    ] }] };
    stripUnsupportedModalities(body, FORMATS.GEMINI, ALL, { noMedia: true });
    const parts = body.contents[0].parts;
    expect(parts.some((p) => p.inlineData || p.fileData)).toBe(false);
    expect(parts.some((p) => p.text === "hi")).toBe(true);
    expect(parts.some((p) => p.functionCall)).toBe(true);
    expect(parts.some((p) => /video omitted: no-media mode/.test(p.text || ""))).toBe(true);
  });

  it("gemini: video passes through without the flag (legacy behavior)", () => {
    const body = { contents: [{ role: "user", parts: [
      { fileData: { mimeType: "video/mp4", fileUri: "http://x/v.mp4" } },
    ] }] };
    stripUnsupportedModalities(body, FORMATS.GEMINI, ALL);
    expect(body.contents[0].parts.some((p) => p.fileData)).toBe(true);
  });
});
