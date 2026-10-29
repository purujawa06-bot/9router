// Ollama Cloud shares the NDJSON protocol with ollama-local: the translator emits
// `stream:false` and the executor re-applies the real stream flag. Regression for
// combo candidates reported as "returned empty (stop)" even though the model did
// return content + tool calls.
import { describe, it, expect } from "vitest";

import { OllamaExecutor } from "../../open-sse/executors/ollama.js";
import { ollamaToOpenAIResponse } from "../../open-sse/translator/response/ollama-to-openai.js";

const MESSAGES = [{ role: "user", content: "hi" }];

describe("ollama cloud streaming", () => {
  const exec = new OllamaExecutor();

  it("passes the real stream flag to the upstream body", () => {
    const out = exec.transformRequest("beam:cloud", { messages: MESSAGES, stream: false }, true, {});
    expect(out.stream).toBe(true);
    expect(out.model).toBe("beam:cloud");
  });

  it("keeps stream:false for non-streaming calls", () => {
    const out = exec.transformRequest("beam:cloud", { messages: MESSAGES, stream: true }, false, {});
    expect(out.stream).toBe(false);
  });
});

describe("ollama done chunk", () => {
  it("delivers content and tool calls carried by a single non-streaming body", () => {
    const state = {};
    const chunk = ollamaToOpenAIResponse(
      {
        model: "beam:cloud",
        done: true,
        done_reason: "stop",
        prompt_eval_count: 90,
        eval_count: 50,
        message: {
          role: "assistant",
          content: "",
          thinking: "I should read the file.",
          tool_calls: [{ id: "call_1", function: { index: 0, name: "read_file", arguments: { path: "README.md" } } }],
        },
      },
      state
    );

    expect(chunk.choices[0].delta.reasoning_content).toBe("I should read the file.");
    expect(chunk.choices[0].delta.tool_calls).toHaveLength(1);
    expect(chunk.choices[0].delta.tool_calls[0].function).toEqual({
      name: "read_file",
      arguments: JSON.stringify({ path: "README.md" }),
    });
    expect(chunk.choices[0].finish_reason).toBe("tool_calls");
    expect(chunk.usage.prompt_tokens).toBe(90);
  });

  it("keeps a plain terminal chunk empty", () => {
    const chunk = ollamaToOpenAIResponse({ model: "beam:cloud", done: true, done_reason: "stop" }, {});
    expect(chunk.choices[0].delta).toEqual({});
    expect(chunk.choices[0].finish_reason).toBe("stop");
  });
});
