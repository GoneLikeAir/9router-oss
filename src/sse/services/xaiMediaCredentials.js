import { getProviderConnectionById, getProviderConnections } from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { getProviderCredentials } from "./auth.js";
import {
  formatRetryAfter,
  getEarliestModelLockUntil,
  isModelLockActive,
} from "open-sse/services/accountFallback.js";
import { planFromAccessToken } from "open-sse/services/usage/grok-cli.js";

export const XAI_MEDIA_PROVIDERS = new Set(["xai", "grok-cli"]);
export const XAI_VIDEO_LOCK_MODEL = "grok-imagine-video";

const RESTRICTED_PLAN_NAMES = new Set(["free", "x basic"]);

export function videoLockModel(parsedModel) {
  return parsedModel || XAI_VIDEO_LOCK_MODEL;
}

export function normalizeImaginePlan(value) {
  if (value == null) return "";
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function isRestrictedPlanName(value) {
  return RESTRICTED_PLAN_NAMES.has(normalizeImaginePlan(value));
}

export function isImagineTierRestricted({ accessToken, subscriptionTier } = {}) {
  const fromJwt = planFromAccessToken(accessToken);
  if (fromJwt && isRestrictedPlanName(fromJwt)) return true;
  if (subscriptionTier && isRestrictedPlanName(subscriptionTier)) return true;
  return false;
}

function hasGrokCliMediaToken(row) {
  return !!(row?.accessToken || row?.refreshToken);
}

function isBorrowableGrokCli(row) {
  return row?.provider === "grok-cli"
    && row?.authType === "oauth"
    && hasGrokCliMediaToken(row);
}

function isPinableMediaRow(row) {
  if (!row || row.isActive === false) return false;
  if (!XAI_MEDIA_PROVIDERS.has(row.provider)) return false;
  if (row.provider === "grok-cli") return isBorrowableGrokCli(row);
  return true;
}

/**
 * Shape required by image/video handlers. Must match getProviderCredentials
 * (connectionId + _connection, resolved proxy fields, never a `provider` field).
 */
export async function toMediaCredentials(row) {
  if (!row) return null;
  const { provider: _provider, ...rest } = row;
  const resolvedProxy = await resolveConnectionProxyConfig(row.providerSpecificData || {});
  return {
    authType: rest.authType,
    apiKey: rest.apiKey,
    accessToken: rest.accessToken,
    refreshToken: rest.refreshToken,
    idToken: rest.idToken,
    expiresAt: rest.expiresAt,
    expiresIn: rest.expiresIn,
    lastRefreshAt: rest.lastRefreshAt,
    projectId: rest.projectId,
    connectionName: rest.displayName || rest.name || rest.email || rest.id,
    copilotToken: rest.providerSpecificData?.copilotToken,
    providerSpecificData: {
      ...(rest.providerSpecificData || {}),
      connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
      connectionProxyUrl: resolvedProxy.connectionProxyUrl,
      connectionNoProxy: resolvedProxy.connectionNoProxy,
      connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
      vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
    },
    testStatus: rest.testStatus,
    lastError: rest.lastError,
    connectionId: rest.id || rest.connectionId,
    _connection: row,
    sourceProvider: row.provider,
  };
}

export function attachSource(credentials, sourceProvider) {
  if (!credentials || credentials.allRateLimited) return credentials;
  if (credentials.sourceProvider) return credentials;
  return { ...credentials, sourceProvider };
}

function rateLimitedFromRows(rows, lastErrorFallback = "Unavailable") {
  if (!rows.length) return null;
  const expiries = rows.map((c) => getEarliestModelLockUntil(c)).filter(Boolean);
  const earliest = expiries.sort()[0] || null;
  if (!earliest) return null;
  const earliestConn = rows[0];
  return {
    allRateLimited: true,
    retryAfter: earliest,
    retryAfterHuman: formatRetryAfter(earliest),
    lastError: earliestConn?.lastError || lastErrorFallback,
    lastErrorCode: earliestConn?.errorCode || null,
  };
}

function mergeRateLimited(a, b) {
  const list = [a, b].filter((item) => item?.allRateLimited);
  if (list.length === 0) return null;
  return [...list].sort((x, y) => {
    const tx = x.retryAfter ? new Date(x.retryAfter).getTime() : Number.POSITIVE_INFINITY;
    const ty = y.retryAfter ? new Date(y.retryAfter).getTime() : Number.POSITIVE_INFINITY;
    return tx - ty;
  })[0];
}

async function resolveGrokCliPool({ excludeSet, model }) {
  const connections = await getProviderConnections({ provider: "grok-cli", isActive: true });
  const borrowable = connections.filter(isBorrowableGrokCli);
  if (borrowable.length === 0) return null;

  const available = borrowable.filter((row) => {
    if (excludeSet.has(row.id)) return false;
    if (isModelLockActive(row, model)) return false;
    if (isImagineTierRestricted({
      accessToken: row.accessToken,
      subscriptionTier: row.providerSpecificData?.subscriptionTier,
    })) return false;
    return true;
  });

  if (available.length === 0) {
    const locked = borrowable.filter((row) => !excludeSet.has(row.id) && isModelLockActive(row, model));
    return rateLimitedFromRows(locked) || null;
  }

  const selected = [...available].sort((a, b) => (a.priority || 999) - (b.priority || 999))[0];
  return await toMediaCredentials(selected);
}

/**
 * Image/video credential picker for xAI Imagine.
 * Two pools (xai first, then grok-cli). Chat routing must not call this.
 */
export async function resolveXaiMediaCredentials(kind, {
  excludeConnectionIds = null,
  model = null,
  preferredConnectionId = null,
} = {}) {
  const excludeSet = excludeConnectionIds instanceof Set
    ? excludeConnectionIds
    : (excludeConnectionIds ? new Set([excludeConnectionIds]) : new Set());

  if (preferredConnectionId && !excludeSet.has(preferredConnectionId)) {
    const pinned = await getProviderConnectionById(preferredConnectionId);
    if (isPinableMediaRow(pinned)) {
      return await toMediaCredentials(pinned);
    }
  }

  const xaiResult = await getProviderCredentials("xai", excludeSet, model);
  if (xaiResult && !xaiResult.allRateLimited) {
    return attachSource(xaiResult, "xai");
  }

  const grokResult = await resolveGrokCliPool({ excludeSet, model });
  if (grokResult && !grokResult.allRateLimited) return grokResult;

  return mergeRateLimited(xaiResult, grokResult) || xaiResult || grokResult || null;
}

function publicAccountName(row) {
  return row.displayName || row.name || row.email || row.id;
}

export async function listXaiMediaAccounts(_kind) {
  const [xaiRows, grokRows] = await Promise.all([
    getProviderConnections({ provider: "xai" }),
    getProviderConnections({ provider: "grok-cli" }),
  ]);

  const accounts = [];
  for (const row of xaiRows) {
    accounts.push({
      id: row.id,
      name: publicAccountName(row),
      email: row.email || null,
      displayName: row.displayName || null,
      sourceProvider: "xai",
      authMode: row.authType === "oauth" ? "oauth" : "apikey",
      readonly: false,
      isActive: row.isActive !== false,
      testStatus: row.testStatus || null,
      subscriptionTier: row.providerSpecificData?.subscriptionTier || null,
      normalizedPlan: planFromAccessToken(row.accessToken) || row.providerSpecificData?.subscriptionTier || null,
      tierRestricted: false,
    });
  }

  for (const row of grokRows) {
    if (row.isActive === false) continue;
    if (!isBorrowableGrokCli(row)) continue;
    const subscriptionTier = row.providerSpecificData?.subscriptionTier || null;
    const normalizedPlan = planFromAccessToken(row.accessToken) || subscriptionTier || null;
    accounts.push({
      id: row.id,
      name: publicAccountName(row),
      email: row.email || null,
      displayName: row.displayName || null,
      sourceProvider: "grok-cli",
      authMode: "oauth",
      readonly: true,
      isActive: row.isActive !== false,
      testStatus: row.testStatus || null,
      subscriptionTier,
      normalizedPlan,
      tierRestricted: isImagineTierRestricted({
        accessToken: row.accessToken,
        subscriptionTier,
      }),
    });
  }

  return accounts;
}
