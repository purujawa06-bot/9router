import { describe, it, expect } from "vitest";
import { pickLatestTagVersion } from "../../open-sse/../src/app/api/version/route.js";

describe("pickLatestTagVersion", () => {
  it("returns null for empty input", () => {
    expect(pickLatestTagVersion([])).toBeNull();
    expect(pickLatestTagVersion(null)).toBeNull();
    expect(pickLatestTagVersion(undefined)).toBeNull();
  });

  it("picks the newest semver tag regardless of list order", () => {
    const tags = [{ name: "v0.5.75" }, { name: "v0.5.9" }, { name: "v0.5.76" }];
    expect(pickLatestTagVersion(tags)).toBe("0.5.76");
  });

  it("ignores non-version tags", () => {
    const tags = [{ name: "release" }, { name: "v0.5.76-beta" }, { name: "v0.5.74" }];
    expect(pickLatestTagVersion(tags)).toBe("0.5.74");
  });

  it("accepts tags without v prefix", () => {
    expect(pickLatestTagVersion([{ name: "0.5.77" }])).toBe("0.5.77");
  });
});
