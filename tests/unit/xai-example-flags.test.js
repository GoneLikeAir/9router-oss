import { describe, it, expect } from "vitest";
import {
  extraBodyFromXaiFields,
  getXaiImageExtraFields,
  getXaiQualityField,
  xaiExampleFlags,
} from "../../src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/xaiExampleFlags.js";

describe("xaiExampleFlags", () => {
  it("does not turn on showMode for Codex edit models", () => {
    const flags = xaiExampleFlags({
      providerId: "codex",
      kind: "image",
      selectedModelObj: { id: "gpt-5.4-image", capabilities: ["edit"] },
      mode: "img2img",
    });
    expect(flags.showMode).toBe(false);
    expect(flags.maxRefImages).toBe(1);
  });

  it("enables JSON-only img2img for xAI edit models", () => {
    const flags = xaiExampleFlags({
      providerId: "xai",
      kind: "image",
      selectedModelObj: { id: "grok-imagine-image", capabilities: ["edit"] },
      mode: "img2img",
      effectiveRefImage: "data:image/png;base64,AAAA",
    });
    expect(flags.showMode).toBe(true);
    expect(flags.useMultipart).toBe(false);
    expect(flags.supportsMask).toBe(false);
    expect(flags.maxRefImages).toBe(3);
  });

  it("keeps multipart for custom Images nodes", () => {
    const flags = xaiExampleFlags({
      providerId: "openai-compatible-images-1",
      kind: "image",
      customAlias: "imgnode",
      imageCapabilities: { edit: true },
      mode: "img2img",
      effectiveRefImage: "data:image/png;base64,AAAA",
    });
    expect(flags.showMode).toBe(true);
    expect(flags.useMultipart).toBe(true);
    expect(flags.supportsMask).toBe(true);
    expect(flags.maxRefImages).toBe(1);
  });

  it("does not enable showMode on deprecated grok-2-image-1212", () => {
    const flags = xaiExampleFlags({
      providerId: "xai",
      kind: "image",
      selectedModelObj: { id: "grok-2-image-1212", params: ["n"] },
      mode: "txt2img",
    });
    expect(flags.showMode).toBe(false);
  });
});

describe("extraBodyFromXaiFields", () => {
  it("keeps official xAI extras and drops leaked OpenAI fields", () => {
    const defs = getXaiImageExtraFields({ mode: "img2img" });
    const body = extraBodyFromXaiFields({
      n: 2,
      aspect_ratio: "auto",
      resolution: "",
      size: "1024x1024",
      style: "vivid",
      quality: "auto",
    }, defs);
    expect(body).toEqual({ n: 2, aspect_ratio: "auto" });
    expect(body.size).toBeUndefined();
    expect(body.style).toBeUndefined();
    expect(body.quality).toBeUndefined();
  });

  it("includes quality only when the 2.0 field is in extraFieldDefs", () => {
    const defs = [...getXaiImageExtraFields({ mode: "txt2img" }), getXaiQualityField()];
    const body = extraBodyFromXaiFields({ n: 1, aspect_ratio: "1:1", quality: "low" }, defs);
    expect(body.quality).toBe("low");
  });
});
