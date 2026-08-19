import { describe, it, expect } from "vitest";
import { mapXaiMediaErrorMessage, XAI_MEDIA_ERRORS } from "@/sse/services/xaiMediaErrors.js";

describe("mapXaiMediaErrorMessage", () => {
  it("maps missing credentials", () => {
    expect(mapXaiMediaErrorMessage({ noCredentials: true })).toBe(XAI_MEDIA_ERRORS.NO_CREDENTIALS);
    expect(XAI_MEDIA_ERRORS.NO_CREDENTIALS).not.toContain("No credentials for provider");
  });

  it("maps 401 by source and auth type", () => {
    expect(mapXaiMediaErrorMessage({ status: 401, sourceProvider: "grok-cli" }))
      .toBe(XAI_MEDIA_ERRORS.GROK_CLI_EXPIRED);
    expect(mapXaiMediaErrorMessage({ status: 401, sourceProvider: "xai", authType: "oauth" }))
      .toBe(XAI_MEDIA_ERRORS.XAI_OAUTH_EXPIRED);
    expect(mapXaiMediaErrorMessage({ status: 401, sourceProvider: "xai", authType: "apikey" }))
      .toBe(XAI_MEDIA_ERRORS.XAI_KEY_INVALID);
  });

  it("maps 403 by source and leaves 402/429/5xx alone", () => {
    expect(mapXaiMediaErrorMessage({ status: 403, sourceProvider: "grok-cli" }))
      .toBe(XAI_MEDIA_ERRORS.GROK_CLI_FORBIDDEN);
    expect(mapXaiMediaErrorMessage({ status: 403, sourceProvider: "xai" }))
      .toBe(XAI_MEDIA_ERRORS.XAI_FORBIDDEN);
    expect(mapXaiMediaErrorMessage({ status: 402, sourceProvider: "grok-cli" })).toBeNull();
    expect(mapXaiMediaErrorMessage({ status: 429, sourceProvider: "xai" })).toBeNull();
    expect(mapXaiMediaErrorMessage({ status: 502, sourceProvider: "xai" })).toBeNull();
  });
});
