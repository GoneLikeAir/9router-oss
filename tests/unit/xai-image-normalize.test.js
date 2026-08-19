import { describe, it, expect } from "vitest";
import { collectRefImages, hasXaiImageInput } from "../../open-sse/handlers/imageProviders/xaiNormalize.js";
import { sizeToXaiAspectRatio, XAI_IMAGINE_MAX_IMAGE_BYTES } from "../../open-sse/config/xaiImagine.js";

describe("hasXaiImageInput", () => {
  it("does not treat mask as image input", () => {
    expect(hasXaiImageInput({ prompt: "x", mask: "m" })).toBe(false);
    expect(hasXaiImageInput({ prompt: "x", mask_image: "m" })).toBe(false);
  });

  it("accepts image, images, and top-level image_url", () => {
    expect(hasXaiImageInput({ image: "https://a" })).toBe(true);
    expect(hasXaiImageInput({ images: ["https://a"] })).toBe(true);
    expect(hasXaiImageInput({ image_url: "https://a" })).toBe(true);
    expect(hasXaiImageInput({ image_url: "  " })).toBe(false);
    expect(hasXaiImageInput({ prompt: "x" })).toBe(false);
  });
});

describe("sizeToXaiAspectRatio", () => {
  it("maps known OpenAI sizes and omits auto/unknown", () => {
    expect(sizeToXaiAspectRatio("1024x1024")).toBe("1:1");
    expect(sizeToXaiAspectRatio("1792x1024")).toBe("16:9");
    expect(sizeToXaiAspectRatio("auto")).toBeUndefined();
    expect(sizeToXaiAspectRatio("512x512")).toBeUndefined();
  });
});

describe("collectRefImages", () => {
  it("normalizes a single URL to official image object", async () => {
    const refs = await collectRefImages({ image: "https://example.com/a.png" });
    expect(refs).toEqual([{ url: "https://example.com/a.png", type: "image_url" }]);
  });

  it("treats file_id strings and objects as file_id, not file.png paths", async () => {
    expect(await collectRefImages({ image: "file_7de029f4-eb66-42ee-87f8-b2a9d9e7466a" }))
      .toEqual([{ file_id: "file_7de029f4-eb66-42ee-87f8-b2a9d9e7466a" }]);
    expect(await collectRefImages({ image: { file_id: "file_abc" } }))
      .toEqual([{ file_id: "file_abc" }]);
    const asUrl = await collectRefImages({ image: "https://example.com/file.png" });
    expect(asUrl[0].file_id).toBeUndefined();
    expect(asUrl[0].url).toBe("https://example.com/file.png");
  });

  it("wraps raw base64 and accepts data URIs", async () => {
    const raw = Buffer.from("png-bytes").toString("base64");
    const refs = await collectRefImages({ image: raw });
    expect(refs[0].url).toBe(`data:image/png;base64,${raw}`);
    const data = await collectRefImages({ image: `data:image/jpeg;base64,${raw}` });
    expect(data[0].url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("uses top-level image_url only when image is absent", async () => {
    const alias = await collectRefImages({ image_url: "https://a" });
    expect(alias).toEqual([{ url: "https://a", type: "image_url" }]);
    const preferImage = await collectRefImages({
      image: "https://keep",
      image_url: "https://ignore",
    });
    expect(preferImage).toEqual([{ url: "https://keep", type: "image_url" }]);
  });

  it("ignores empty images array and rejects non-empty image + images", async () => {
    const onlyImage = await collectRefImages({ image: "https://a", images: [] });
    expect(onlyImage).toHaveLength(1);
    await expect(collectRefImages({ image: "https://a", images: ["https://b"] }))
      .rejects.toThrow("Send either \"image\" or \"images\", not both.");
  });

  it("rejects more than 3 images and empty objects", async () => {
    await expect(collectRefImages({
      images: ["https://a", "https://b", "https://c", "https://d"],
    })).rejects.toThrow("Grok Imagine accepts at most 3 reference images.");
    await expect(collectRefImages({ image: { url: "" } }))
      .rejects.toThrow("Invalid reference image encoding");
  });

  it("rejects non jpeg/png/webp data URIs", async () => {
    await expect(collectRefImages({ image: "data:image/gif;base64,AAAA" }))
      .rejects.toThrow("Reference images must be JPEG, PNG, or WebP.");
  });

  it("rejects data URI / raw base64 over the 20 MB local cap", async () => {
    const big = Buffer.alloc(XAI_IMAGINE_MAX_IMAGE_BYTES + 1, 1).toString("base64");
    await expect(collectRefImages({ image: `data:image/png;base64,${big}` }))
      .rejects.toThrow("Reference image exceeds 20 MB");
    await expect(collectRefImages({ image: big }))
      .rejects.toThrow("Reference image exceeds 20 MB");
  });

  it("accepts a Blob as a data URI", async () => {
    const blob = new Blob([Buffer.from("png-bytes")], { type: "image/png" });
    const refs = await collectRefImages({ image: blob });
    expect(refs[0].url).toMatch(/^data:image\/png;base64,/);
  });
});
