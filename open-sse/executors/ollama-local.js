import { DefaultExecutor } from "./default.js";
import { resolveOllamaLocalHost } from "../config/providers.js";

export class OllamaLocalExecutor extends DefaultExecutor {
  constructor() {
    super("ollama-local");
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    return `${resolveOllamaLocalHost(credentials)}/api/chat`;
  }

  // Port of upstream PR decolua/9router#4133 (Ollama local streaming for VS
  // Code chat): force the translated body to carry the resolved model id and
  // the real stream flag. Unlike the upstream patch, the DefaultExecutor
  // pipeline (param stripping, reasoning injection) is preserved via super.
  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body);
    return {
      ...transformed,
      model,
      stream
    };
  }
}

export default OllamaLocalExecutor;
