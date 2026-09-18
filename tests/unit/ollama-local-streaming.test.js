// Upstream PR decolua/9router#4133 — Ollama local streaming support for VS Code chat.
// Ollama streams NDJSON (application/x-ndjson), not SSE, so:
//  - the translator emits stream:false (Ollama-compatible base body),
//  - OllamaLocalExecutor.transformRequest re-applies the resolved model + real
//    stream flag on top of the DefaultExecutor pipeline.
import { describe, it, expect } from "vitest";
import { OllamaLocalExecutor } from "../../open-sse/executors/ollama-local.js";
import { openaiToOllamaRequest } from "../../open-sse/translator/request/openai-to-ollama.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

const MESSAGES = [{ role: "user", content: "hi" }];

describe("ollama-local streaming (#4133)", () => {
  const exec = new OllamaLocalExecutor();

  it("executor passes stream:true through to the Ollama body", () => {
    const out = exec.transformRequest("llama3.2:3b", { messages: MESSAGES, stream: false }, true, {});
    expect(out.model).toBe("llama3.2:3b");
    expect(out.stream).toBe(true);
    expect(out.messages).toEqual(MESSAGES);
  });

  it("executor passes stream:false through for non-streaming calls", () => {
    const out = exec.transformRequest("llama3.2:3b", { messages: MESSAGES, stream: true }, false, {});
    expect(out.model).toBe("llama3.2:3b");
    expect(out.stream).toBe(false);
  });

  it("translator emits stream:false; the executor (not the translator) owns the flag", () => {
    const translated = openaiToOllamaRequest("llama3.2:3b", { messages: MESSAGES }, true);
    expect(translated.stream).toBe(false);
    const out = exec.transformRequest("llama3.2:3b", translated, true, {});
    expect(out.stream).toBe(true);
  });

  it("registry carries a local validateUrl and a default model", () => {
    const entry = REGISTRY.find((candidate) => candidate.id === "ollama-local");
    expect(entry.transport.validateUrl).toBe("http://localhost:11434/api/tags");
    expect(entry.models).toContainEqual({ id: "llama3.2:3b", name: "Llama 3.2 3B" });
  });
});
