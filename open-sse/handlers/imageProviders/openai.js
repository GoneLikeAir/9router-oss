// OpenAI-compatible adapter (used by openai, minimax, openrouter, recraft)
import { PROVIDER_MEDIA } from "../../providers/index.js";
import {
  GROK_CLI_CLIENT_IDENTIFIER,
  GROK_CLI_USER_AGENT,
  GROK_CLI_VERSION,
} from "../../config/grokCli.js";

const imageCfg = (id) => PROVIDER_MEDIA[id]?.imageConfig || {};
const imageUrl = (id) => imageCfg(id).baseUrl;

export default function createOpenAIAdapter(providerId) {
  const cfg = imageCfg(providerId);
  return {
    buildUrl: () => imageUrl(providerId),
    buildHeaders: (creds) => {
      const headers = { "Content-Type": "application/json", ...(cfg.headers || {}) };
      const key = creds?.apiKey || creds?.accessToken;
      if (key) headers["Authorization"] = `Bearer ${key}`;
      if (providerId === "xai" && creds?.sourceProvider === "grok-cli") {
        headers["User-Agent"] = GROK_CLI_USER_AGENT;
        headers["x-grok-client-version"] = GROK_CLI_VERSION;
        headers["x-grok-client-identifier"] = GROK_CLI_CLIENT_IDENTIFIER;
        if (creds.connectionId) headers["x-grok-session-id"] = creds.connectionId;
      }
      return headers;
    },
    buildBody: (model, body) => {
      const { prompt, n = 1, size = "1024x1024", quality, style, response_format } = body;
      const full = { model, prompt, n, size };
      if (quality) full.quality = quality;
      if (style) full.style = style;
      if (response_format) full.response_format = response_format;
      // bodyFields whitelist (e.g. xAI accepts only model/prompt/n/response_format)
      if (Array.isArray(cfg.bodyFields)) {
        const req = {};
        for (const f of cfg.bodyFields) if (full[f] !== undefined) req[f] = full[f];
        return req;
      }
      return full;
    },
    normalize: (responseBody) => responseBody,
  };
}
