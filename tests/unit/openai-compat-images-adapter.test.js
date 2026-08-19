import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => globalThis.fetch(args[0], args[1]),
  default: (...args) => globalThis.fetch(args[0], args[1]),
}));

import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";
import adapter, { hasImageInput } from "../../open-sse/handlers/imageProviders/openaiCompatNode.js";

const IMAGES_ID = "openai-compatible-images-ba5485cc-48af-4502-aa90-890fd8e5e10b";
const creds = {
  apiKey: "sk-test",
  providerSpecificData: { baseUrl: "https://images.example.com/v1", apiType: "images", prefix: "imgnode" },
};

const originalFetch = global.fetch;

describe("openai compat images adapter", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("hasImageInput detects image/images/mask", () => {
    expect(hasImageInput({ prompt: "x" })).toBe(false);
    expect(hasImageInput({ image: "abc" })).toBe(true);
    expect(hasImageInput({ images: ["abc"] })).toBe(true);
    expect(hasImageInput({ mask: "abc" })).toBe(true);
  });

  it("throws when baseUrl is missing", async () => {
    const result = await handleImageGenerationCore({
      body: { prompt: "a cat" },
      modelInfo: { provider: IMAGES_ID, model: "gpt-image-2" },
      credentials: { apiKey: "sk-test", providerSpecificData: { apiType: "images" } },
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain("baseUrl");
    expect(result.reachedUpstream).not.toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("posts generations JSON to the node baseUrl", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ created: 1, data: [{ b64_json: "abc" }] }), { status: 200 })
    );
    const result = await handleImageGenerationCore({
      body: { prompt: "a cat", size: "1024x1024" },
      modelInfo: { provider: IMAGES_ID, model: "gpt-image-2" },
      credentials: creds,
    });
    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://images.example.com/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        }),
      })
    );
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.model).toBe("gpt-image-2");
    expect(sent.prompt).toBe("a cat");
  });

  it("posts edits FormData without JSON content-type when image is present", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ created: 1, data: [{ b64_json: "xyz" }] }), { status: 200 })
    );
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const result = await handleImageGenerationCore({
      body: { prompt: "make blue", image: png.toString("base64") },
      modelInfo: { provider: IMAGES_ID, model: "gpt-image-2" },
      credentials: creds,
    });
    expect(result.success).toBe(true);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://images.example.com/v1/images/edits");
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers["Content-Type"]).toBeUndefined();
    expect(init.headers.Authorization).toBe("Bearer sk-test");
  });

  it("buildUrl refuses to fall back to api.openai.com", () => {
    expect(() => adapter.buildUrl("gpt-image-2", { providerSpecificData: {} }, {})).toThrow(/baseUrl/);
  });

  it("rejects reference images over 20MB", async () => {
    const huge = Buffer.alloc(20 * 1024 * 1024 + 10, 1).toString("base64");
    await expect(adapter.buildBody("gpt-image-2", { prompt: "x", image: huge }, {})).rejects.toThrow(/20 MB/);
  });

  it("appends a mask file on edits", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const form = await adapter.buildBody("gpt-image-2", {
      prompt: "x",
      image: png.toString("base64"),
      mask: png.toString("base64"),
    }, {});
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("mask")).toBeTruthy();
  });
});
