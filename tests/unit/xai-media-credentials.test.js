import { describe, it, expect, vi, beforeEach } from "vitest";

const authMocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
}));
const dbMocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  getProviderConnections: vi.fn(),
}));
const proxyMocks = vi.hoisted(() => ({
  resolveConnectionProxyConfig: vi.fn(async (psd = {}) => ({
    connectionProxyEnabled: psd.connectionProxyEnabled === true,
    connectionProxyUrl: psd.connectionProxyUrl || "",
    connectionNoProxy: psd.connectionNoProxy || "",
    proxyPoolId: psd.proxyPoolId || null,
    vercelRelayUrl: "",
  })),
}));

vi.mock("@/sse/services/auth.js", () => authMocks);
vi.mock("@/lib/localDb", () => dbMocks);
vi.mock("@/lib/network/connectionProxy", () => proxyMocks);

import {
  attachSource,
  isImagineTierRestricted,
  listXaiMediaAccounts,
  resolveXaiMediaCredentials,
  toMediaCredentials,
  videoLockModel,
} from "@/sse/services/xaiMediaCredentials.js";

function jwtWithTier(tier) {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ tier })).toString("base64url");
  return `${header}.${payload}.sig`;
}

function grokCliRow(overrides = {}) {
  return {
    id: "gcli-1",
    provider: "grok-cli",
    authType: "oauth",
    isActive: true,
    accessToken: jwtWithTier(1),
    refreshToken: "ref-gcli",
    name: "Grok CLI",
    email: "user@example.com",
    priority: 1,
    providerSpecificData: { subscriptionTier: "super_grok" },
    ...overrides,
  };
}

function xaiCreds(overrides = {}) {
  return {
    connectionId: "xai-1",
    accessToken: "xai-tok",
    apiKey: "xai-key",
    authType: "apikey",
    ...overrides,
  };
}

beforeEach(() => {
  authMocks.getProviderCredentials.mockReset();
  dbMocks.getProviderConnectionById.mockReset();
  dbMocks.getProviderConnections.mockReset();
  dbMocks.getProviderConnections.mockResolvedValue([]);
  proxyMocks.resolveConnectionProxyConfig.mockClear();
});

describe("toMediaCredentials", () => {
  it("maps a grok-cli row without copying provider", async () => {
    const creds = await toMediaCredentials(grokCliRow());
    expect(creds.connectionId).toBe("gcli-1");
    expect(creds.sourceProvider).toBe("grok-cli");
    expect(creds.accessToken).toBeTruthy();
    expect(creds._connection.id).toBe("gcli-1");
    expect(creds.provider).toBeUndefined();
    expect(Object.hasOwn(creds, "provider")).toBe(false);
  });

  it("resolves connection proxy fields like getProviderCredentials", async () => {
    proxyMocks.resolveConnectionProxyConfig.mockResolvedValueOnce({
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.example:8080",
      connectionNoProxy: "localhost",
      proxyPoolId: "pool-1",
      vercelRelayUrl: "https://relay.example",
    });
    const creds = await toMediaCredentials(grokCliRow({
      providerSpecificData: { subscriptionTier: "super_grok", proxyPoolId: "pool-1" },
    }));
    expect(proxyMocks.resolveConnectionProxyConfig).toHaveBeenCalled();
    expect(creds.providerSpecificData).toMatchObject({
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.example:8080",
      connectionNoProxy: "localhost",
      connectionProxyPoolId: "pool-1",
      vercelRelayUrl: "https://relay.example",
    });
    expect(creds.provider).toBeUndefined();
  });
});

describe("isImagineTierRestricted", () => {
  it("treats JWT tier 0 and 2 as restricted", () => {
    expect(isImagineTierRestricted({ accessToken: jwtWithTier(0) })).toBe(true);
    expect(isImagineTierRestricted({ accessToken: jwtWithTier(2) })).toBe(true);
    expect(isImagineTierRestricted({ accessToken: jwtWithTier(1) })).toBe(false);
  });

  it("treats free / x_basic strings as restricted and unknown as fail-open", () => {
    expect(isImagineTierRestricted({ subscriptionTier: "free" })).toBe(true);
    expect(isImagineTierRestricted({ subscriptionTier: "X_Basic" })).toBe(true);
    expect(isImagineTierRestricted({ subscriptionTier: "super_grok" })).toBe(false);
    expect(isImagineTierRestricted({})).toBe(false);
  });
});

describe("resolveXaiMediaCredentials", () => {
  it("maps only grok-cli oauth into the borrow pool", async () => {
    authMocks.getProviderCredentials.mockResolvedValueOnce(null);
    dbMocks.getProviderConnections.mockResolvedValueOnce([grokCliRow()]);

    const creds = await resolveXaiMediaCredentials("image", {});
    expect(creds.sourceProvider).toBe("grok-cli");
    expect(creds.connectionId).toBe("gcli-1");
    expect(creds.provider).toBeUndefined();
  });

  it("prefers a real xai account when both exist", async () => {
    authMocks.getProviderCredentials.mockResolvedValueOnce(xaiCreds());
    const creds = await resolveXaiMediaCredentials("image", {});
    expect(creds.sourceProvider).toBe("xai");
    expect(creds.connectionId).toBe("xai-1");
    expect(dbMocks.getProviderConnections).not.toHaveBeenCalled();
  });

  it("falls through xai allRateLimited to grok-cli", async () => {
    authMocks.getProviderCredentials.mockResolvedValueOnce({
      allRateLimited: true,
      retryAfter: new Date(Date.now() + 60_000).toISOString(),
      lastError: "xai locked",
    });
    dbMocks.getProviderConnections.mockResolvedValueOnce([grokCliRow()]);

    const creds = await resolveXaiMediaCredentials("image", { model: "grok-2-image-1212" });
    expect(creds.sourceProvider).toBe("grok-cli");
    expect(creds.connectionId).toBe("gcli-1");
  });

  it("merges allRateLimited when both pools are exhausted", async () => {
    const retry = new Date(Date.now() + 30_000).toISOString();
    authMocks.getProviderCredentials.mockResolvedValueOnce({
      allRateLimited: true,
      retryAfter: retry,
      lastError: "xai locked",
    });
    dbMocks.getProviderConnections.mockResolvedValueOnce([
      grokCliRow({ [`modelLock_grok-2-image-1212`]: new Date(Date.now() + 90_000).toISOString() }),
    ]);

    const creds = await resolveXaiMediaCredentials("image", { model: "grok-2-image-1212" });
    expect(creds.allRateLimited).toBe(true);
    expect(creds.retryAfter).toBe(retry);
  });

  it("pins a grok-cli id even when an xai key exists", async () => {
    dbMocks.getProviderConnectionById.mockResolvedValueOnce(grokCliRow());
    const creds = await resolveXaiMediaCredentials("image", { preferredConnectionId: "gcli-1" });
    expect(creds.connectionId).toBe("gcli-1");
    expect(creds.sourceProvider).toBe("grok-cli");
    expect(creds.provider).toBeUndefined();
    expect(creds._connection).toBeTruthy();
    expect(authMocks.getProviderCredentials).not.toHaveBeenCalled();
  });

  it("does not return an excluded pin (rotation must leave the row)", async () => {
    authMocks.getProviderCredentials.mockResolvedValueOnce(xaiCreds());
    const creds = await resolveXaiMediaCredentials("image", {
      preferredConnectionId: "gcli-1",
      excludeConnectionIds: new Set(["gcli-1"]),
    });
    expect(creds.connectionId).toBe("xai-1");
    expect(dbMocks.getProviderConnectionById).not.toHaveBeenCalled();
  });

  it("keeps a pinned grok-cli row even when that media model is locked", async () => {
    dbMocks.getProviderConnectionById.mockResolvedValueOnce(
      grokCliRow({ "modelLock_grok-imagine-video": new Date(Date.now() + 60_000).toISOString() })
    );
    const creds = await resolveXaiMediaCredentials("video", {
      preferredConnectionId: "gcli-1",
      model: "grok-imagine-video",
    });
    expect(creds.connectionId).toBe("gcli-1");
  });

  it("ignores grok-web and inactive pins", async () => {
    dbMocks.getProviderConnectionById.mockResolvedValueOnce({
      id: "web-1",
      provider: "grok-web",
      authType: "cookie",
      isActive: true,
      accessToken: "cookie",
    });
    authMocks.getProviderCredentials.mockResolvedValueOnce(xaiCreds());
    const creds = await resolveXaiMediaCredentials("image", { preferredConnectionId: "web-1" });
    expect(creds.connectionId).toBe("xai-1");
  });

  it("skips grok-cli apikey / tokenless rows", async () => {
    authMocks.getProviderCredentials.mockResolvedValueOnce(null);
    dbMocks.getProviderConnections.mockResolvedValueOnce([
      grokCliRow({ authType: "apikey", apiKey: "nope", accessToken: null, refreshToken: null }),
    ]);
    const creds = await resolveXaiMediaCredentials("image", {});
    expect(creds).toBeNull();
  });
});

describe("listXaiMediaAccounts", () => {
  it("never returns tokens and marks borrowed grok-cli readonly", async () => {
    dbMocks.getProviderConnections
      .mockResolvedValueOnce([
        { id: "xai-1", provider: "xai", authType: "apikey", isActive: true, apiKey: "secret", name: "Key" },
      ])
      .mockResolvedValueOnce([grokCliRow({ accessToken: "SECRET_TOKEN" })]);

    const accounts = await listXaiMediaAccounts("image");
    expect(accounts).toHaveLength(2);
    expect(accounts.every((a) => !a.accessToken && !a.apiKey && !a.refreshToken)).toBe(true);
    expect(accounts[1]).toMatchObject({
      sourceProvider: "grok-cli",
      readonly: true,
      authMode: "oauth",
    });
  });

  it("includes disabled xai rows so the detail page can show ConnectionsCard", async () => {
    dbMocks.getProviderConnections
      .mockResolvedValueOnce([
        { id: "xai-off", provider: "xai", authType: "apikey", isActive: false, name: "Off key" },
      ])
      .mockResolvedValueOnce([]);
    const accounts = await listXaiMediaAccounts("image");
    expect(accounts).toEqual([
      expect.objectContaining({ id: "xai-off", sourceProvider: "xai", isActive: false, readonly: false }),
    ]);
  });
});

describe("helpers", () => {
  it("videoLockModel never returns null", () => {
    expect(videoLockModel(null)).toBe("grok-imagine-video");
    expect(videoLockModel("custom-video")).toBe("custom-video");
  });

  it("attachSource does not invent a provider field", () => {
    const attached = attachSource({ connectionId: "x" }, "xai");
    expect(attached.sourceProvider).toBe("xai");
    expect(attached.provider).toBeUndefined();
  });
});
