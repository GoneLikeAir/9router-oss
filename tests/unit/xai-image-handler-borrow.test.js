import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const authMocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: true, cooldownMs: 0 })),
  clearAccountError: vi.fn(async () => {}),
  extractApiKey: vi.fn(() => null),
  isValidApiKey: vi.fn(async () => true),
}));
const tokenMocks = vi.hoisted(() => ({
  checkAndRefreshToken: vi.fn(async (_p, creds) => creds),
  updateProviderCredentials: vi.fn(async () => {}),
}));
const mediaMocks = vi.hoisted(() => ({
  resolveXaiMediaCredentials: vi.fn(),
}));
const coreMocks = vi.hoisted(() => ({
  handleImageGenerationCore: vi.fn(),
}));

vi.mock("@/sse/services/auth.js", () => authMocks);
vi.mock("@/sse/services/tokenRefresh.js", () => tokenMocks);
vi.mock("@/sse/services/xaiMediaCredentials.js", () => mediaMocks);
vi.mock("open-sse/handlers/imageGenerationCore.js", () => coreMocks);
vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({ requireApiKey: false })),
  getComboByName: vi.fn(async () => null),
  getModelAliases: vi.fn(async () => ({})),
  getProviderNodes: vi.fn(async () => []),
}));
vi.mock("@/sse/utils/logger.js", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));

import { handleImageGeneration } from "@/sse/handlers/imageGeneration.js";
import { XAI_MEDIA_ERRORS } from "@/sse/services/xaiMediaErrors.js";

const originalFetch = global.fetch;

const makeRequest = (body) =>
  new Request("http://localhost/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  global.fetch = vi.fn();
  authMocks.getProviderCredentials.mockReset();
  authMocks.markAccountUnavailable.mockClear();
  tokenMocks.checkAndRefreshToken.mockClear();
  mediaMocks.resolveXaiMediaCredentials.mockReset();
  coreMocks.handleImageGenerationCore.mockReset();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("handleImageGeneration xai borrow", () => {
  it("does not expose No credentials for provider: xai", async () => {
    mediaMocks.resolveXaiMediaCredentials.mockResolvedValueOnce(null);
    const res = await handleImageGeneration(makeRequest({
      model: "xai/grok-2-image-1212",
      prompt: "a cat",
    }));
    const text = await res.text();
    expect(res.status).toBe(400);
    expect(text).toContain(XAI_MEDIA_ERRORS.NO_CREDENTIALS);
    expect(text).not.toContain("No credentials for provider: xai");
  });

  it("refreshes and locks using sourceProvider", async () => {
    mediaMocks.resolveXaiMediaCredentials.mockResolvedValueOnce({
      connectionId: "gcli-1",
      sourceProvider: "grok-cli",
      authType: "oauth",
      accessToken: "tok",
    });
    coreMocks.handleImageGenerationCore.mockResolvedValueOnce({
      success: false,
      status: 401,
      error: "[401]: expired",
      reachedUpstream: true,
      response: new Response(JSON.stringify({ error: { message: "expired" } }), { status: 401 }),
    });

    const res = await handleImageGeneration(makeRequest({
      model: "xai/grok-2-image-1212",
      prompt: "a cat",
    }));
    const body = await res.json();
    expect(body.error.message).toBe(XAI_MEDIA_ERRORS.GROK_CLI_EXPIRED);
    expect(tokenMocks.checkAndRefreshToken).toHaveBeenCalledWith("grok-cli", expect.objectContaining({
      connectionId: "gcli-1",
    }));
    expect(authMocks.markAccountUnavailable).toHaveBeenCalledWith(
      "gcli-1", 401, expect.any(String), "grok-cli", "grok-2-image-1212"
    );
  });

  it("maps xai apikey 401 to the key sentence", async () => {
    mediaMocks.resolveXaiMediaCredentials.mockResolvedValueOnce({
      connectionId: "xai-1",
      sourceProvider: "xai",
      authType: "apikey",
      apiKey: "bad",
    });
    coreMocks.handleImageGenerationCore.mockResolvedValueOnce({
      success: false,
      status: 401,
      error: "[401]: invalid",
      reachedUpstream: true,
      response: new Response(JSON.stringify({ error: { message: "invalid" } }), { status: 401 }),
    });
    const res = await handleImageGeneration(makeRequest({
      model: "xai/grok-2-image-1212",
      prompt: "a cat",
    }));
    expect((await res.json()).error.message).toBe(XAI_MEDIA_ERRORS.XAI_KEY_INVALID);
  });

  it("does not rotate on 5xx", async () => {
    mediaMocks.resolveXaiMediaCredentials.mockResolvedValueOnce({
      connectionId: "gcli-1",
      sourceProvider: "grok-cli",
      authType: "oauth",
      accessToken: "tok",
    });
    coreMocks.handleImageGenerationCore.mockResolvedValueOnce({
      success: false,
      status: 502,
      error: "[502]: boom",
      response: new Response(JSON.stringify({ error: { message: "boom" } }), { status: 502 }),
    });

    await handleImageGeneration(makeRequest({
      model: "xai/grok-2-image-1212",
      prompt: "a cat",
    }));
    expect(mediaMocks.resolveXaiMediaCredentials).toHaveBeenCalledTimes(1);
  });
});
