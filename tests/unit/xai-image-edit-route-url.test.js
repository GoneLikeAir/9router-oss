import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => globalThis.fetch(args[0], args[1]),
  default: (...args) => globalThis.fetch(args[0], args[1]),
}));

import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn(async () => new Response(JSON.stringify({
    data: [{ url: "https://out" }],
  }), { status: 200, headers: { "Content-Type": "application/json" } }));
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("xai image core routing", () => {
  it("sends generations + image_url to /v1/images/edits with JSON image", async () => {
    const result = await handleImageGenerationCore({
      body: {
        prompt: "sketch",
        image_url: "https://docs.x.ai/assets/api-examples/images/style-realistic.png",
      },
      modelInfo: { provider: "xai", model: "grok-imagine-image" },
      credentials: { apiKey: "xai-key", sourceProvider: "xai" },
    });
    expect(result.success).toBe(true);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/images/edits");
    const sent = JSON.parse(init.body);
    expect(sent.image).toEqual({
      url: "https://docs.x.ai/assets/api-examples/images/style-realistic.png",
      type: "image_url",
    });
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("keeps prompt-only requests on generations", async () => {
    await handleImageGenerationCore({
      body: { prompt: "a cat" },
      modelInfo: { provider: "xai", model: "grok-imagine-image" },
      credentials: { apiKey: "xai-key" },
    });
    expect(global.fetch.mock.calls[0][0]).toBe("https://api.x.ai/v1/images/generations");
  });
});
