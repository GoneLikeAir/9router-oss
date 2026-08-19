import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderNodes: async () => [],
}));

import { GET } from "../../src/app/api/v1/models/info/route.js";

describe("xai models/info edit capability", () => {
  it.each([
    "xai/grok-imagine-image",
    "xai/grok-imagine-image-quality",
    "xai/grok-imagine-image-2.0",
  ])("advertises edit + editEndpoint on %s", async (id) => {
    const res = await GET(new Request(`http://localhost/v1/models/info?id=${id}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.capabilities).toContain("edit");
    expect(body.editEndpoint).toBe("/v1/images/edits");
  });

  it("does not advertise edit on deprecated grok-2-image-1212", async () => {
    const res = await GET(new Request("http://localhost/v1/models/info?id=xai/grok-2-image-1212"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.capabilities || []).not.toContain("edit");
    expect(body.editEndpoint).toBeUndefined();
  });
});
