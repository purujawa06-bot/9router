import { DefaultExecutor } from "./default.js";

// Ollama Cloud speaks the same NDJSON protocol as ollama-local: the request
// translator deliberately emits `stream:false` (Ollama-compatible base body), so
// the executor owns the real stream flag. Without this override every chat request
// is answered upstream as one JSON body, and streaming clients see an empty
// `stop` reply (no content, no tool calls).
export class OllamaExecutor extends DefaultExecutor {
  constructor() {
    super("ollama");
  }

  transformRequest(model, body, stream) {
    return {
      ...super.transformRequest(model, body),
      model,
      stream,
    };
  }
}

export default OllamaExecutor;
