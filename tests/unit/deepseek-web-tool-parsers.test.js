import { describe, it, expect } from "vitest";

import {
  formatDeepSeekWebToolPrompt,
  parseDeepSeekWebAiSdkTools,
} from "open-sse/translator/deepseekWebAiSdkTools.js";

const tools = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file from disk",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
];

describe("deepseek-web AI-SDK tool prompts", () => {
  it("teaches uiTars the qwen3Coder envelope its protocol parses", async () => {
    const prompt = await formatDeepSeekWebToolPrompt("uiTars", tools);

    expect(prompt).toContain("<tool_call>");
    expect(prompt).toContain("<function=example_function_name>");
    expect(prompt).toContain("<parameter=example_parameter_1>");
    expect(prompt).not.toContain("<rules>");
  });

  it("parses a uiTars tool call", async () => {
    const text = [
      "<tool_call>",
      "<function=read_file>",
      "<parameter=path>",
      "README.md",
      "</parameter>",
      "</function>",
      "</tool_call>",
    ].join("\n");

    const parsed = await parseDeepSeekWebAiSdkTools("uiTars", text, tools);

    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.toolCalls[0].function.name).toBe("read_file");
    expect(JSON.parse(parsed.toolCalls[0].function.arguments)).toEqual({ path: "README.md" });
  });
});

describe("deepseek-web bare XML salvage", () => {
  it("recovers morphXml-style markup that the configured protocol cannot read", async () => {
    const text = "<read_file>\n<path>README.md</path>\n</read_file>";

    const parsed = await parseDeepSeekWebAiSdkTools("uiTars", text, tools);

    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.toolCalls[0].function.name).toBe("read_file");
    expect(JSON.parse(parsed.toolCalls[0].function.arguments)).toEqual({ path: "README.md" });
    expect(parsed.content).toBe("");
  });

  it("leaves plain prose untouched", async () => {
    const parsed = await parseDeepSeekWebAiSdkTools("uiTars", "README.md contains setup notes.", tools);

    expect(parsed.toolCalls).toHaveLength(0);
    expect(parsed.content).toBe("README.md contains setup notes.");
  });

  it("does not salvage tags that are not a requested tool", async () => {
    const text = "<note>\n<path>README.md</path>\n</note>";

    const parsed = await parseDeepSeekWebAiSdkTools("uiTars", text, tools);

    expect(parsed.toolCalls).toHaveLength(0);
    expect(parsed.content).toBe(text);
  });
});
