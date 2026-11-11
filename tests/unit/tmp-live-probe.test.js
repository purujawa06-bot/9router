import { describe, it } from "vitest";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";

const CHAT = [
  "big-pickle",
  "beam-free",
  "flint-40b-free",
  "cat-jam-free",
  "deepseek-v4.1-flash-free",
  "glm-5.3-flash-free",
  "longcat-2.5-preview-free",
  "mimo-v2.6-flash-free",
  "nemotron-3.5-lightning-free",
  "nemotron-3.5-super-vl-free",
  "space-bunny-free",
  "muse-spark-1.2-contributor-free",
];
const RESPONSES = ["muse-spark-1.3-contributor-free", "muse-spark-1.4-contributor-free"];

describe("live opencode free probe", () => {
  it("probes", { timeout: 300000 }, async () => {
    const ex = new OpenCodeExecutor();
    const rows = [];
    for (const model of [...CHAT, ...RESPONSES]) {
      const body = RESPONSES.includes(model)
        ? { input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }] }
        : { messages: [{ role: "user", content: "hi" }] };
      try {
        const res = await ex.execute({
          model, body, stream: true,
          credentials: { connectionId: "probe", providerSpecificData: {} },
        });
        let snippet = "";
        if (res.response?.status !== 200) {
          try { snippet = (await res.response.text()).slice(0, 140).replace(/\s+/g, " "); } catch { }
        } else {
          try { res.response.body?.cancel?.(); } catch { }
        }
        rows.push(`${res.response?.status}\t${model}\t${snippet}`);
      } catch (e) {
        rows.push(`ERR\t${model}\t${e.message}`);
      }
    }
    console.log("\n===PROBE===\n" + rows.join("\n") + "\n===END===");
  });
});
