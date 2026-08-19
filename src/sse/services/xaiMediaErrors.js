import { errorResponse } from "open-sse/utils/error.js";

export const XAI_MEDIA_ERRORS = {
  NO_CREDENTIALS: "Log in to Grok CLI (Grok Build), or add an xAI API key.",
  GROK_CLI_EXPIRED: "Grok Build login expired. Reconnect it under Providers → Grok CLI.",
  XAI_OAUTH_EXPIRED: "xAI OAuth expired. Reconnect it under Providers → xAI (Grok).",
  XAI_KEY_INVALID: "This xAI API key is invalid. Update it under Providers → xAI (Grok).",
  GROK_CLI_FORBIDDEN:
    "This Grok Build plan cannot use Imagine. Upgrade on grok.com, or use an API key from console.x.ai.",
  XAI_FORBIDDEN: "This xAI account cannot use Imagine. Check the key or plan on console.x.ai.",
};

/**
 * Map Imagine auth/permission failures to a source-specific user sentence.
 * Returns null when the caller should keep the existing message (402/429/5xx).
 */
export function mapXaiMediaErrorMessage({
  status,
  sourceProvider,
  authType,
  noCredentials = false,
} = {}) {
  if (noCredentials) return XAI_MEDIA_ERRORS.NO_CREDENTIALS;

  const code = Number(status);
  if (code === 401) {
    if (sourceProvider === "grok-cli") return XAI_MEDIA_ERRORS.GROK_CLI_EXPIRED;
    if (sourceProvider === "xai" && authType === "oauth") return XAI_MEDIA_ERRORS.XAI_OAUTH_EXPIRED;
    if (sourceProvider === "xai") return XAI_MEDIA_ERRORS.XAI_KEY_INVALID;
  }
  if (code === 403) {
    if (sourceProvider === "grok-cli") return XAI_MEDIA_ERRORS.GROK_CLI_FORBIDDEN;
    if (sourceProvider === "xai") return XAI_MEDIA_ERRORS.XAI_FORBIDDEN;
  }
  return null;
}

export function rewriteXaiMediaErrorResponse(result, credentials) {
  if (!result || result.success) return result?.response || null;
  const mapped = mapXaiMediaErrorMessage({
    status: result.status,
    sourceProvider: credentials?.sourceProvider,
    authType: credentials?.authType,
  });
  if (!mapped) return result.response;
  return errorResponse(result.status || 502, mapped);
}
