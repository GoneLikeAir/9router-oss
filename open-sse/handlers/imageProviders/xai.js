import { PROVIDER_MEDIA } from "../../providers/index.js";
import {
  GROK_CLI_CLIENT_IDENTIFIER,
  GROK_CLI_USER_AGENT,
  GROK_CLI_VERSION,
} from "../../config/grokCli.js";
import {
  XAI_IMAGINE_ASPECT_RATIOS,
  XAI_IMAGINE_QUALITY_MODELS,
  XAI_IMAGINE_RESOLUTIONS,
  sizeToXaiAspectRatio,
} from "../../config/xaiImagine.js";
import { nowSec } from "./_base.js";
import { collectRefImages, hasXaiImageInput } from "./xaiNormalize.js";

const cfg = () => PROVIDER_MEDIA.xai?.imageConfig || {};

function generationsUrl() {
  return cfg().generationsUrl || cfg().baseUrl || "https://api.x.ai/v1/images/generations";
}

function editsUrl() {
  return cfg().editsUrl || "https://api.x.ai/v1/images/edits";
}

function pickQuality(model, quality) {
  if (!XAI_IMAGINE_QUALITY_MODELS.has(model)) return undefined;
  if (quality === "low" || quality === "medium") return quality;
  return undefined;
}

export default {
  buildUrl(_model, _creds, body) {
    return hasXaiImageInput(body) ? editsUrl() : generationsUrl();
  },

  buildHeaders(creds) {
    const headers = { "Content-Type": "application/json" };
    const key = creds?.apiKey || creds?.accessToken;
    if (key) headers.Authorization = `Bearer ${key}`;
    if (creds?.sourceProvider === "grok-cli") {
      headers["User-Agent"] = GROK_CLI_USER_AGENT;
      headers["x-grok-client-version"] = GROK_CLI_VERSION;
      headers["x-grok-client-identifier"] = GROK_CLI_CLIENT_IDENTIFIER;
      if (creds.connectionId) headers["x-grok-session-id"] = creds.connectionId;
    }
    return headers;
  },

  async buildBody(model, body) {
    const req = { model, prompt: body.prompt };
    if (body.n != null && body.n !== "") req.n = body.n;

    if (body.aspect_ratio) {
      if (!XAI_IMAGINE_ASPECT_RATIOS.includes(body.aspect_ratio)) {
        throw new Error(`Invalid aspect_ratio. Use: ${XAI_IMAGINE_ASPECT_RATIOS.join(", ")}`);
      }
      req.aspect_ratio = body.aspect_ratio;
    } else {
      const mapped = sizeToXaiAspectRatio(body.size);
      if (mapped) req.aspect_ratio = mapped;
    }

    if (body.resolution) {
      if (!XAI_IMAGINE_RESOLUTIONS.includes(body.resolution)) {
        throw new Error(`Invalid resolution. Use: ${XAI_IMAGINE_RESOLUTIONS.join(", ")}`);
      }
      req.resolution = body.resolution;
    }

    if (body.response_format) req.response_format = body.response_format;
    if (body.storage_options) req.storage_options = body.storage_options;
    if (body.user) req.user = body.user;

    const quality = pickQuality(model, body.quality);
    if (quality) req.quality = quality;

    if (hasXaiImageInput(body)) {
      const refs = await collectRefImages(body);
      if (refs.length === 0) throw new Error("Missing required field: image");
      if (refs.length === 1) req.image = refs[0];
      else req.images = refs;
    }

    return req;
  },

  normalize(parsed) {
    return parsed?.data ? { ...parsed, created: parsed.created ?? nowSec() } : parsed;
  },
};
