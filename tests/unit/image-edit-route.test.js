import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ requireApiKey: false }),
  getProviderNodes: async () => [],
  getComboByName: async () => null,
  getModelAliases: async () => ({}),
}));
vi.mock("@/sse/services/auth.js", () => ({
  extractApiKey: () => null,
  isValidApiKey: async () => true,
}));

import { hasImageInput } from "../../open-sse/handlers/imageProviders/openaiCompatNode.js";
import { handleImageGeneration } from "../../src/sse/handlers/imageGeneration.js";
import { handleImageEdit } from "../../src/sse/handlers/imageEdit.js";

describe("image edit input detection", () => {
  it("requires an image field", () => {
    expect(hasImageInput({ prompt: "x" })).toBe(false);
    expect(hasImageInput({ prompt: "x", image: "abc" })).toBe(true);
    expect(hasImageInput({ images: ["a"] })).toBe(true);
    expect(hasImageInput({ mask: "m" })).toBe(true);
  });

  it("rejects multipart on generations", async () => {
    const req = new Request("http://127.0.0.1/v1/images/generations", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body: "--x--",
    });
    const res = await handleImageGeneration(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toContain("Use POST /v1/images/edits");
  });

  it("rejects xAI edits that only send a mask", async () => {
    const req = new Request("http://127.0.0.1/v1/images/edits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "xai/grok-imagine-image",
        prompt: "edit",
        mask: "https://example.com/mask.png",
      }),
    });
    const res = await handleImageEdit(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toContain("does not support masks");
  });

  it("handleImageEdit requires image", async () => {
    const req = new Request("http://127.0.0.1/v1/images/edits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "imgnode/gpt-image-2", prompt: "make blue" }),
    });
    const res = await handleImageEdit(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toContain("image");
  });
});
