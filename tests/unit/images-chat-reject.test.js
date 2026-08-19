import { describe, it, expect, vi, beforeEach } from "vitest";

const IMAGES_ID = "openai-compatible-images-ba5485cc-48af-4502-aa90-890fd8e5e10b";
const fetchSpy = vi.fn();

vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ requireApiKey: false }),
}));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: async () => ({ provider: IMAGES_ID, model: "gpt-image-2" }),
  getComboModels: async () => null,
}));
vi.mock("@/models", () => ({
  getProviderNodeById: async () => ({ id: IMAGES_ID, prefix: "imgnode", apiType: "images" }),
}));
vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchSpy(...args),
  default: (...args) => fetchSpy(...args),
}));

import { handleChat } from "../../src/sse/handlers/chat.js";
import { DefaultExecutor } from "open-sse/executors/default.js";
import { imagesNodeChatMessage } from "open-sse/services/provider.js";

describe("images chat reject", () => {
  beforeEach(() => {
    fetchSpy.mockReset();
    global.fetch = fetchSpy;
  });

  it("executor does not emit a chat completions URL", () => {
    const ex = new DefaultExecutor(IMAGES_ID);
    expect(() => ex.buildUrl("gpt-image-2", true, 0, {
      providerSpecificData: { apiType: "images", prefix: "imgnode", baseUrl: "https://images.example.com/v1" },
    })).toThrow(imagesNodeChatMessage("imgnode"));
  });

  it("handleChat 400s before any upstream fetch", async () => {
    const req = new Request("http://127.0.0.1/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "imgnode/gpt-image-2",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    const res = await handleChat(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toBe(imagesNodeChatMessage("imgnode"));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
