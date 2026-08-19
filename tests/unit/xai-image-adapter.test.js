import { describe, it, expect } from "vitest";
import adapter from "../../open-sse/handlers/imageProviders/xai.js";
import { XAI_IMAGINE_EDIT_FIELDS, XAI_IMAGINE_GEN_FIELDS } from "../../open-sse/config/xaiImagine.js";

describe("xai image adapter", () => {
  it("routes generations vs edits by image input including image_url", () => {
    expect(adapter.buildUrl("grok-imagine-image", {}, { prompt: "x" }))
      .toBe("https://api.x.ai/v1/images/generations");
    expect(adapter.buildUrl("grok-imagine-image", {}, { prompt: "x", image: "https://a" }))
      .toBe("https://api.x.ai/v1/images/edits");
    expect(adapter.buildUrl("grok-imagine-image", {}, { prompt: "x", image_url: "https://a" }))
      .toBe("https://api.x.ai/v1/images/edits");
  });

  it("never returns FormData and emits official JSON image object", async () => {
    const body = await adapter.buildBody("grok-imagine-image", {
      prompt: "sketch",
      image: "https://example.com/a.png",
      n: 1,
      aspect_ratio: "16:9",
      resolution: "2k",
    });
    expect(typeof FormData === "undefined" || !(body instanceof FormData)).toBe(true);
    expect(body.image).toEqual({ url: "https://example.com/a.png", type: "image_url" });
    expect(body.images).toBeUndefined();
    expect(body.aspect_ratio).toBe("16:9");
    expect(body.resolution).toBe("2k");
    expect(body.size).toBeUndefined();
    expect(body.mask).toBeUndefined();
    for (const key of Object.keys(body)) {
      expect(XAI_IMAGINE_EDIT_FIELDS).toContain(key);
    }
  });

  it("generation bodies only use official gen fields", async () => {
    const body = await adapter.buildBody("grok-imagine-image", {
      prompt: "x",
      n: 1,
      aspect_ratio: "auto",
    });
    for (const key of Object.keys(body)) {
      expect(XAI_IMAGINE_GEN_FIELDS).toContain(key);
    }
  });

  it("uses images[] for 2–3 refs", async () => {
    const body = await adapter.buildBody("grok-imagine-image", {
      prompt: "blend <IMAGE_0> and <IMAGE_1>",
      images: ["https://a", "https://b"],
    });
    expect(body.image).toBeUndefined();
    expect(body.images).toHaveLength(2);
  });

  it("forwards quality only for 2.0 low|medium", async () => {
    const ok = await adapter.buildBody("grok-imagine-image-2.0", {
      prompt: "x",
      quality: "low",
    });
    expect(ok.quality).toBe("low");
    const dropped = await adapter.buildBody("grok-imagine-image-2.0", {
      prompt: "x",
      quality: "high",
    });
    expect(dropped.quality).toBeUndefined();
    const other = await adapter.buildBody("grok-imagine-image", {
      prompt: "x",
      quality: "medium",
    });
    expect(other.quality).toBeUndefined();
  });

  it("maps known size and omits auto/unknown", async () => {
    const mapped = await adapter.buildBody("grok-imagine-image", {
      prompt: "x",
      size: "1024x1024",
    });
    expect(mapped.aspect_ratio).toBe("1:1");
    const auto = await adapter.buildBody("grok-imagine-image", {
      prompt: "x",
      size: "auto",
    });
    expect(auto.aspect_ratio).toBeUndefined();
    const odd = await adapter.buildBody("grok-imagine-image", {
      prompt: "x",
      size: "512x512",
    });
    expect(odd.aspect_ratio).toBeUndefined();
  });

  it("rejects invalid aspect_ratio", async () => {
    await expect(adapter.buildBody("grok-imagine-image", {
      prompt: "x",
      aspect_ratio: "7:3",
    })).rejects.toThrow(/Invalid aspect_ratio/);
  });

  it("spreads usage when normalizing", () => {
    const out = adapter.normalize({
      data: [{ url: "https://u" }],
      usage: { total_tokens: 3 },
    });
    expect(out.data[0].url).toBe("https://u");
    expect(out.usage.total_tokens).toBe(3);
    expect(out.created).toEqual(expect.any(Number));
  });
});
