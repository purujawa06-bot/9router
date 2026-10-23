import { describe, expect, it, vi } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

describe("combo credit fallback", () => {
  it.each([
    "You have insufficient credits to make this request.",
    "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
    "Bad request",
  ])("advances past a 400 response: %s", async (message) => {
    const body = { messages: [{ role: "user", content: "Hello" }] };
    const models = ["cmc/deepseek/deepseek-v4-pro", "mistral/mistral-medium-latest"];
    const failure = Response.json({ error: { message } }, { status: 400 });
    const success = Response.json({ choices: [{ message: { content: "Hello" } }] });
    const handleSingleModel = vi.fn()
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce(success);

    const response = await handleComboChat({
      body, models, handleSingleModel,
      log: { info: vi.fn(), warn: vi.fn() },
      comboName: "credit-fallback", comboStrategy: "fallback",
    });

    // Every 400 here is a member-scoped rejection (quota or request shape): the
    // next combo member must still get a chance to serve the request.
    expect(response).toBe(success);
    expect(handleSingleModel.mock.calls).toEqual(models.map((model) => [body, model]));
  });

  it("returns the first request-scoped failure when no member serves the request", async () => {
    const body = { messages: [{ role: "user", content: "Hello" }] };
    const models = ["cmc/deepseek/deepseek-v4-pro", "mistral/mistral-medium-latest"];
    const failure = Response.json({ error: { message: "Bad request" } }, { status: 400 });
    const later = Response.json({ error: { message: "Bad request" } }, { status: 400 });
    const handleSingleModel = vi.fn()
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce(later);

    const response = await handleComboChat({
      body, models, handleSingleModel,
      log: { info: vi.fn(), warn: vi.fn() },
      comboName: "credit-fallback-all-fail", comboStrategy: "fallback",
    });

    // Nothing else could serve it: hand back the original upstream error, not a
    // synthesized "no accounts available".
    expect(response).toBe(failure);
  });
});
