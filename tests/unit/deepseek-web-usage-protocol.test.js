import { describe, it, expect, vi, beforeEach } from "vitest";

const settingsState = vi.hoisted(() => ({ providerToolProtocols: {} }));

vi.mock("@/lib/db/repos/settingsRepo.js", () => ({
  getSettings: vi.fn(async () => ({
    providerToolProtocols: settingsState.providerToolProtocols,
  })),
}));

import { __test__ } from "open-sse/executors/deepseek-web.js";

const { buildToolAwareOpenAIResult, resolveToolProtocol } = __test__;

const requestPayload = {
  prompt: "Summarize this file and call the read tool with path README.md",
  thinking_enabled: false,
  search_enabled: false,
};

function toolCall() {
  return {
    id: "call-1",
    type: "function",
    function: { name: "read", arguments: JSON.stringify({ path: "README.md" }) },
  };
}

describe("deepseek-web usage reporting", () => {
  it("returns non-zero estimated usage for non-streaming tool calls", async () => {
    const result = buildToolAwareOpenAIResult({
      stream: false,
      clientModel: "deepseek-web",
      content: "",
      reasoningContent: "",
      toolCalls: [toolCall()],
      reqHeaders: {},
      requestPayload,
      toolProtocol: "hermes",
    });

    const body = await result.response.json();
    expect(body.choices[0].finish_reason).toBe("tool_calls");
    expect(body.usage.prompt_tokens).toBeGreaterThan(0);
    expect(body.usage.completion_tokens).toBeGreaterThan(0);
    expect(body.usage.total_tokens).toBeGreaterThan(0);
    expect(result.toolProtocol).toBe("hermes");
  });

  it("emits usage on the finish chunk for streaming tool calls", async () => {
    const result = buildToolAwareOpenAIResult({
      stream: true,
      clientModel: "deepseek-web",
      content: "",
      reasoningContent: "",
      toolCalls: [toolCall()],
      reqHeaders: {},
      requestPayload,
      toolProtocol: "deepseek",
    });

    const text = await result.response.text();
    const chunks = text
      .split("\n\n")
      .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
      .map((line) => JSON.parse(line.slice(6)));
    const withUsage = chunks.find((chunk) => chunk.usage);

    expect(withUsage).toBeTruthy();
    expect(withUsage.usage.prompt_tokens).toBeGreaterThan(0);
    expect(withUsage.usage.completion_tokens).toBeGreaterThan(0);
  });
});

describe("deepseek-web tool protocol scope", () => {
  beforeEach(() => {
    settingsState.providerToolProtocols = {};
  });

  it("uses the provider-wide setting regardless of the connection value", async () => {
    settingsState.providerToolProtocols = { "deepseek-web": "morphXml" };
    const protocol = await resolveToolProtocol({
      providerSpecificData: { deepseekWebToolProtocol: "hermes" },
    });
    expect(protocol).toBe("morphXml");
  });

  it("falls back to the legacy connection value when no global setting exists", async () => {
    const protocol = await resolveToolProtocol({
      providerSpecificData: { deepseekWebToolProtocol: "qwen3Coder" },
    });
    expect(protocol).toBe("qwen3Coder");
  });

  it("defaults to the native DeepSeek parser", async () => {
    expect(await resolveToolProtocol({})).toBe("deepseek");
  });
});
