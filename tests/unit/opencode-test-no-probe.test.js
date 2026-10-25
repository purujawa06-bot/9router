import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/models", () => ({
  getProviderNodeById: vi.fn(),
  getProviderConnectionById: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));

vi.mock("@/lib/network/proxyTest", () => ({
  testProxyUrl: vi.fn(),
}));

const originalFetch = global.fetch;
const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");

const makeConnection = (overrides) => ({
  id: "conn-1",
  provider: "opencode",
  authType: "apikey",
  apiKey: "public",
  providerSpecificData: {},
  ...overrides,
});

describe("opencode connection test", () => {
  beforeEach(() => {
    mocks.getProviderConnectionById.mockReset();
    mocks.updateProviderConnection.mockReset();
    mocks.resolveConnectionProxyConfig.mockReset();
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("free lane returns valid without any network call", async () => {
    mocks.getProviderConnectionById.mockResolvedValue(makeConnection());

    const result = await testSingleConnection("conn-1");

    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      "conn-1",
      expect.objectContaining({ testStatus: "active" }),
    );
  });

  it("opencode-go keeps its live probe", async () => {
    mocks.getProviderConnectionById.mockResolvedValue(
      makeConnection({ provider: "opencode-go", apiKey: "sk-real" }),
    );
    global.fetch.mockResolvedValue(new Response("{}", { status: 200 }));

    const result = await testSingleConnection("conn-1");

    expect(result.valid).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(String(url)).toContain("/zen/go/v1/chat/completions");
    expect(init.method).toBe("POST");
  });
});
