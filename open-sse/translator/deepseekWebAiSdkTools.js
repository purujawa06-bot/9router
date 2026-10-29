// Bridge OpenAI-style tools <-> @ai-sdk-tool/parser profiles for non-native tool
// providers (DeepSeek web, ...). Keeps 9router's native SSE shapes intact by only
// using the parser for prompt building + text extraction on buffered replies.
import { FORMATS } from "./formats.js";

let parserModulePromise = null;
async function getParserModule() {
  if (!parserModulePromise) parserModulePromise = import("@ai-sdk-tool/parser");
  return await parserModulePromise;
}

const PROTOCOL_FACTORIES = {
  hermes: (m) => m.hermesProtocol(),
  morphXml: (m) => m.morphXmlProtocol(),
  yamlXml: (m) => m.yamlXmlProtocol(),
  qwen3Coder: (m) => m.qwen3CoderProtocol(),
  uiTars: (m) => m.uiTarsXmlProtocol(),
  deepseek: null,
};

const SYSTEM_PROMPT_FACTORIES = {
  hermes: (m) => m.hermesSystemPromptTemplate,
  morphXml: (m) => m.morphXmlSystemPromptTemplate,
  yamlXml: (m) => m.yamlXmlSystemPromptTemplate,
  qwen3Coder: (m) => m.qwen3coderSystemPromptTemplate,
  // Upstream aliases `uiTarsXmlProtocol` to `qwen3CoderProtocol`, so the prompt must
  // teach that same `<tool_call><function=...>` markup — a morphXml prompt makes the
  // model emit bare XML tags the protocol parser cannot read.
  uiTars: (m) => m.qwen3coderSystemPromptTemplate,
};

export function isAiSdkDeepSeekWebToolProfile(profile) {
  return Object.prototype.hasOwnProperty.call(PROTOCOL_FACTORIES, profile) && profile !== "deepseek";
}

function toToolCallInputJson(input) {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input ?? {});
  } catch {
    return "{}";
  }
}

function toV4Tools(tools) {
  return (Array.isArray(tools) ? tools : [])
    .map((t) => t?.function || t)
    .filter((t) => t && t.name)
    .map((t) => ({
      type: "function",
      name: t.name,
      description: t.description || "",
      inputSchema: (t.parameters && typeof t.parameters === "object") ? t.parameters : (t.inputSchema || { type: "object" }),
    }));
}

export async function formatDeepSeekWebToolPrompt(profile, tools) {
  const parser = await getParserModule();
  const protocolFactory = PROTOCOL_FACTORIES[profile];
  if (!protocolFactory) return null;
  const protocol = protocolFactory(parser);
  if (!protocol || typeof protocol.formatTools !== "function") return null;
  const template = SYSTEM_PROMPT_FACTORIES[profile]?.(parser) || SYSTEM_PROMPT_FACTORIES.morphXml(parser);
  const v4Tools = toV4Tools(tools);
  if (!v4Tools.length) return null;

  const raw = protocol.formatTools({ tools: v4Tools, toolSystemPromptTemplate: (incomingTools) => template(incomingTools) });
  return String(raw || "").trim();
}

function parseWithProtocol(protocol, content, v4Tools) {
  const parsed = protocol.parseGeneratedText({ text: content || "", tools: v4Tools, options: {} });
  const contentParts = [];
  const toolCalls = [];
  for (const part of parsed || []) {
    if (part?.type === "text" && typeof part.text === "string") {
      contentParts.push(part.text);
      continue;
    }
    if (part?.type === "tool-call") {
      toolCalls.push({
        id: part.toolCallId || `call-${Date.now()}-${toolCalls.length}`,
        type: "function",
        function: {
          name: part.toolName || "",
          arguments: toToolCallInputJson(part.input),
        },
      });
    }
  }
  return { content: contentParts.join("").trim(), toolCalls };
}

function mentionsRequestedToolTag(content, v4Tools) {
  if (!content || !v4Tools.length) return false;
  const names = v4Tools.map((t) => t.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`<\\s*(?:${names.join("|")})\\b`).test(content);
}

export async function parseDeepSeekWebAiSdkTools(profile, content, tools) {
  const parser = await getParserModule();
  const protocolFactory = PROTOCOL_FACTORIES[profile];
  if (!protocolFactory) return null;
  const protocol = protocolFactory(parser);
  if (!protocol || typeof protocol.parseGeneratedText !== "function") return null;

  const v4Tools = toV4Tools(tools);
  const result = parseWithProtocol(protocol, content, v4Tools);
  if (result.toolCalls.length > 0 || !mentionsRequestedToolTag(content, v4Tools)) {
    return result;
  }

  // Models sometimes answer an XML-shaped prompt with bare `<tool_name><param>…`
  // markup instead of the protocol's own envelope. Salvage those calls rather than
  // returning empty tool_calls while the markup sits in the visible content.
  const morphProtocol = parser.morphXmlProtocol?.();
  if (morphProtocol && typeof morphProtocol.parseGeneratedText === "function") {
    const salvaged = parseWithProtocol(morphProtocol, result.content, v4Tools);
    if (salvaged.toolCalls.length > 0) return salvaged;
  }
  return result;
}

export const DEEPSEEK_WEB_AI_SDK_TOOL_PROFILES = Object.keys(PROTOCOL_FACTORIES).filter((k) => k !== "deepseek");