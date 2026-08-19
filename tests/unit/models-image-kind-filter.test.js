import { describe, it, expect, vi } from "vitest";

const IMAGES_ID = "openai-compatible-images-ba5485cc-48af-4502-aa90-890fd8e5e10b";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async () => ([{
    id: "conn-imgnode",
    provider: IMAGES_ID,
    isActive: true,
    apiKey: "sk-test",
    providerSpecificData: {
      prefix: "imgnode",
      apiType: "images",
      baseUrl: "https://images.example.com/v1",
      enabledModels: ["gpt-image-2", "gpt-5.4"],
    },
  }]),
  getCombos: async () => [],
  getCustomModels: async () => [],
  getModelAliases: async () => ({}),
}));
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: async () => ({}),
}));

import { buildModelsList } from "../../src/app/api/v1/models/route.js";
import {
  compatibleNodeServiceKinds,
  resolveCompatibleApiType,
} from "../../src/shared/constants/compatibleNodes.js";

describe("images node kind filter", () => {
  it("maps images apiType to image service kind only", () => {
    expect(resolveCompatibleApiType(IMAGES_ID, null)).toBe("images");
    expect(compatibleNodeServiceKinds("images")).toEqual(["image"]);
    expect(compatibleNodeServiceKinds("chat")).toEqual(["llm"]);
  });

  it("lists images-node ids only on the image filter", async () => {
    const image = await buildModelsList(["image"]);
    const llm = await buildModelsList(["llm"]);
    const imageIds = image.map((m) => m.id);
    const llmIds = llm.map((m) => m.id);
    expect(imageIds).toContain("imgnode/gpt-image-2");
    expect(imageIds).toContain("imgnode/gpt-5.4");
    expect(llmIds.some((id) => String(id).startsWith("imgnode/"))).toBe(false);
  });
});
