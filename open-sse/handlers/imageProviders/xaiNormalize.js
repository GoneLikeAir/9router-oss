import {
  XAI_FILE_ID_RE,
  XAI_IMAGINE_MAX_IMAGE_BYTES,
  XAI_IMAGINE_MAX_REF_IMAGES,
} from "../../config/xaiImagine.js";

const DATA_URI_RE = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i;
const HTTP_RE = /^https?:\/\//i;
const ALLOWED_FILE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

export function hasXaiImageInput(body = {}) {
  if (body.image) return true;
  if (typeof body.image_url === "string" && body.image_url.trim()) return true;
  if (Array.isArray(body.images) && body.images.length > 0) return true;
  return false;
}

function isFileLike(value) {
  if (value == null || typeof value !== "object") return false;
  if (typeof File !== "undefined" && value instanceof File) return true;
  if (typeof Blob !== "undefined" && value instanceof Blob) return true;
  return false;
}

function assertByteLength(len) {
  if (len > XAI_IMAGINE_MAX_IMAGE_BYTES) {
    throw new Error("Reference image exceeds 20 MB");
  }
}

function assertMime(mime) {
  const normalized = String(mime || "").toLowerCase();
  if (!ALLOWED_FILE_TYPES.has(normalized) && normalized !== "image/jpg") {
    throw new Error("Reference images must be JPEG, PNG, or WebP.");
  }
}

async function bytesToDataUri(buf, mime = "image/png") {
  assertByteLength(buf.length);
  const type = mime === "image/jpg" ? "image/jpeg" : mime;
  return { url: `data:${type};base64,${Buffer.from(buf).toString("base64")}`, type: "image_url" };
}

async function normalizeFileLike(value) {
  const mime = value.type || "image/png";
  if (value.type) assertMime(value.type);
  const size = typeof value.size === "number" ? value.size : 0;
  if (size) assertByteLength(size);
  const buf = Buffer.from(await value.arrayBuffer());
  assertByteLength(buf.length);
  return bytesToDataUri(buf, mime || "image/png");
}

async function normalizeOne(value) {
  if (value == null || value === "") {
    throw new Error("Invalid reference image encoding");
  }

  if (Buffer.isBuffer(value)) {
    return bytesToDataUri(value, "image/png");
  }

  if (isFileLike(value)) {
    return normalizeFileLike(value);
  }

  if (typeof value === "object") {
    if (value.file_id) return { file_id: String(value.file_id) };
    const url = value.url || value.image_url;
    if (typeof url === "string" && url.trim()) {
      return normalizeString(url.trim());
    }
    throw new Error("Invalid reference image encoding");
  }

  if (typeof value === "string") {
    return normalizeString(value.trim());
  }

  throw new Error("Invalid reference image encoding");
}

function normalizeString(trimmed) {
  if (!trimmed) throw new Error("Invalid reference image encoding");
  if (XAI_FILE_ID_RE.test(trimmed)) return { file_id: trimmed };
  if (HTTP_RE.test(trimmed)) return { url: trimmed, type: "image_url" };
  const data = DATA_URI_RE.exec(trimmed);
  if (data) {
    const mime = `image/${data[1].toLowerCase() === "jpg" ? "jpeg" : data[1].toLowerCase()}`;
    assertMime(mime);
    const raw = Buffer.from(data[2], "base64");
    if (!raw.length) throw new Error("Invalid reference image encoding");
    assertByteLength(raw.length);
    return { url: trimmed, type: "image_url" };
  }
  if (/^data:/i.test(trimmed)) {
    throw new Error("Reference images must be JPEG, PNG, or WebP.");
  }
  // Raw base64
  let raw;
  try {
    raw = Buffer.from(trimmed, "base64");
  } catch {
    throw new Error("Invalid reference image encoding");
  }
  if (!raw.length) throw new Error("Invalid reference image encoding");
  assertByteLength(raw.length);
  return { url: `data:image/png;base64,${trimmed}`, type: "image_url" };
}

export async function collectRefImages(body = {}) {
  const hasImage = body.image != null && body.image !== "";
  const hasImages = Array.isArray(body.images) && body.images.length > 0;
  if (hasImage && hasImages) {
    throw new Error('Send either "image" or "images", not both.');
  }

  const raw = [];
  if (hasImages) raw.push(...body.images);
  else if (hasImage) raw.push(body.image);
  else if (typeof body.image_url === "string" && body.image_url.trim()) {
    raw.push(body.image_url.trim());
  }

  if (raw.length > XAI_IMAGINE_MAX_REF_IMAGES) {
    throw new Error("Grok Imagine accepts at most 3 reference images.");
  }

  const out = [];
  for (const item of raw) {
    out.push(await normalizeOne(item));
  }
  return out;
}
