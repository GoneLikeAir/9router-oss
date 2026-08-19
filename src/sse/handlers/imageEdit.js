import { extractApiKey, isValidApiKey } from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo } from "../services/model.js";
import { handleSingleModelImage } from "./imageGeneration.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { hasXaiImageInput } from "open-sse/handlers/imageProviders/xaiNormalize.js";

function hasImageInput(body) {
  if (!body) return false;
  if (body.image) return true;
  if (body.mask || body.mask_image) return true;
  if (Array.isArray(body.images) && body.images.length > 0) return true;
  return false;
}

function formDataToEditBody(form) {
  const body = {};
  const images = [];
  for (const [key, value] of form.entries()) {
    if (key === "image" || key === "images") {
      images.push(value);
      continue;
    }
    if (key === "mask" || key === "mask_image") {
      body.mask = value;
      continue;
    }
    if (typeof value === "string") {
      if (key === "n" || key === "partial_images") {
        const n = Number(value);
        body[key] = Number.isFinite(n) ? n : value;
      } else {
        body[key] = value;
      }
    } else {
      body[key] = value;
    }
  }
  if (images.length === 1) body.image = images[0];
  else if (images.length > 1) body.images = images;
  return body;
}

function flagsFrom(request) {
  const url = new URL(request.url);
  return {
    wantsStream: (request.headers.get("accept") || "").includes("text/event-stream"),
    binaryOutput: url.searchParams.get("response_format") === "binary",
    preferredConnectionId: request.headers.get("x-connection-id") || null,
  };
}

export async function handleImageEdit(request) {
  const ctype = request.headers.get("content-type") || "";
  let body;
  try {
    if (ctype.includes("multipart/form-data")) {
      body = formDataToEditBody(await request.formData());
    } else {
      body = await request.json();
    }
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid request body");
  }

  const apiKey = extractApiKey(request);
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    const valid = await isValidApiKey(apiKey);
    if (!valid) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }

  if (!body.model) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  if (!body.prompt) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: prompt");

  const modelInfo = await getModelInfo(body.model);
  if (modelInfo?.provider === "xai") {
    const hasMask = !!(body.mask || body.mask_image);
    if (!hasXaiImageInput(body)) {
      if (hasMask) {
        return errorResponse(HTTP_STATUS.BAD_REQUEST, "Grok Imagine does not support masks. Send image or images.");
      }
      return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: image");
    }
  } else if (!hasImageInput(body)) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: image");
  }

  return handleSingleModelImage(body, body.model, flagsFrom(request));
}
