import { describe, it, expect } from "vitest";
import adapter from "../../open-sse/handlers/imageProviders/xai.js";

describe("xai image adapter headers", () => {

  it("adds Grok CLI client headers only when credentials are borrowed", () => {
    const headers = adapter.buildHeaders({
      accessToken: "oidc",
      sourceProvider: "grok-cli",
      connectionId: "gcli-1",
    });
    expect(headers.Authorization).toBe("Bearer oidc");
    expect(headers["x-grok-client-identifier"]).toBeTruthy();
    expect(headers["x-grok-client-version"]).toBeTruthy();
    expect(headers["User-Agent"]).toMatch(/^grok-shell\//);
    expect(headers["x-grok-session-id"]).toBe("gcli-1");
    expect(headers["x-xai-token-auth"]).toBeUndefined();
  });

  it("does not add Grok CLI headers for a real xai API key", () => {
    const headers = adapter.buildHeaders({ apiKey: "xai-key", sourceProvider: "xai" });
    expect(headers.Authorization).toBe("Bearer xai-key");
    expect(headers["x-grok-client-identifier"]).toBeUndefined();
    expect(headers["User-Agent"]).toBeUndefined();
  });
});
