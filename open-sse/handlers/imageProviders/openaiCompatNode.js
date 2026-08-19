import { proxyAwareFetch } from "../../utils/proxyFetch.js";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const SCALAR_FIELDS = [
  "n", "size", "quality", "style", "response_format",
  "output_format", "background", "moderation", "partial_images",
];

function rawBaseUrl(creds) {
  const raw = creds?.providerSpecificData?.baseUrl;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("Custom images node is missing baseUrl");
  }
  return raw.trim().replace(/\/$/, "").replace(/\/images\/(generations|edits)$/i, "");
}

export function hasImageInput(body = {}) {
  if (body.image) return true;
  if (body.mask || body.mask_image) return true;
  if (Array.isArray(body.images) && body.images.length > 0) return true;
  return false;
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "url";
  }
}

async function bytesFromString(value, proxyOptions) {
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    let res;
    try {
      res = await proxyAwareFetch(trimmed, { method: "GET" }, proxyOptions);
    } catch (err) {
      throw new Error(`Failed to fetch reference image from ${hostnameOf(trimmed)}`);
    }
    if (!res.ok) {
      throw new Error(`Failed to fetch reference image from ${hostnameOf(trimmed)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) throw new Error("Reference image exceeds 20 MB");
    return buf;
  }
  const match = /^data:image\/[^;]+;base64,(.+)$/i.exec(trimmed);
  const b64 = match ? match[1] : trimmed;
  let buf;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    throw new Error("Invalid reference image encoding");
  }
  if (buf.length > MAX_IMAGE_BYTES) throw new Error("Reference image exceeds 20 MB");
  return buf;
}

async function toFilePart(value, filename, proxyOptions) {
  if (value == null || value === "") return null;
  if (typeof File !== "undefined" && value instanceof File) {
    if (value.size > MAX_IMAGE_BYTES) throw new Error("Reference image exceeds 20 MB");
    return value;
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    if (value.size > MAX_IMAGE_BYTES) throw new Error("Reference image exceeds 20 MB");
    return new File([value], filename, { type: value.type || "image/png" });
  }
  if (Buffer.isBuffer(value)) {
    if (value.length > MAX_IMAGE_BYTES) throw new Error("Reference image exceeds 20 MB");
    return new File([value], filename, { type: "image/png" });
  }
  if (typeof value === "string") {
    const buf = await bytesFromString(value, proxyOptions);
    if (!buf) return null;
    return new File([buf], filename, { type: "image/png" });
  }
  return null;
}

function appendScalars(target, body, asForm) {
  for (const key of SCALAR_FIELDS) {
    const value = body[key];
    if (value === undefined || value === null || value === "") continue;
    if (asForm) target.append(key, String(value));
    else target[key] = value;
  }
}

export default {
  buildUrl(_model, creds, body) {
    const base = rawBaseUrl(creds);
    return `${base}/images/${hasImageInput(body) ? "edits" : "generations"}`;
  },

  async buildBody(model, body, { proxyOptions } = {}) {
    if (hasImageInput(body)) {
      const form = new FormData();
      form.append("model", model);
      if (body.prompt) form.append("prompt", body.prompt);

      const images = Array.isArray(body.images) && body.images.length
        ? body.images
        : (body.image != null && body.image !== "" ? [body.image] : []);
      let index = 0;
      for (const img of images) {
        const file = await toFilePart(img, index === 0 ? "image.png" : `image-${index}.png`, proxyOptions);
        if (file) {
          form.append("image", file, file.name || "image.png");
          index += 1;
        }
      }
      if (index === 0) throw new Error("Missing required field: image");

      const maskSrc = body.mask || body.mask_image;
      if (maskSrc) {
        const mask = await toFilePart(maskSrc, "mask.png", proxyOptions);
        if (mask) form.append("mask", mask, mask.name || "mask.png");
      }

      appendScalars(form, body, true);
      return form;
    }

    const req = { model, prompt: body.prompt };
    appendScalars(req, body, false);
    return req;
  },

  buildHeaders(creds, requestBody) {
    const headers = {};
    const isMultipart = typeof FormData !== "undefined" && requestBody instanceof FormData;
    if (!isMultipart) headers["Content-Type"] = "application/json";
    const key = creds?.apiKey || creds?.accessToken;
    if (key) headers.Authorization = `Bearer ${key}`;
    return headers;
  },

  normalize(responseBody) {
    return responseBody;
  },
};
