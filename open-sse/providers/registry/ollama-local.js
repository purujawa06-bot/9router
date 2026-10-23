export default {
  id: "ollama-local",
  priority: 50,
  hasFree: true,
  alias: "ollama-local",
  display: {
    name: "Ollama Local",
    icon: "cloud",
    color: "#ffffffff",
    textIcon: "OL",
    website: "https://ollama.com",
  },
  category: "apikey",
  transport: {
    baseUrl: "http://localhost:11434/api/chat",
    validateUrl: "http://localhost:11434/api/tags",
    format: "ollama",
  },
  models: [
    { id: "llama3.2:3b", name: "Llama 3.2 3B" },
    { id: "clef", name: "Clef", kind: "systemone" },
    { id: "clef-flash", name: "Clef Flash", kind: "systemone" },
  ],
  serviceKinds: ["llm", "systemone"],
  systemoneConfig: {
    baseUrl: "http://localhost:11434/v1/systemone",
    // Saved host (providerSpecificData.baseUrl) is joined with this path.
    path: "/v1/systemone",
  },
};
