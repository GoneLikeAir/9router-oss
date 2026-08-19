/**
 * Detail-page phase for xAI image/video. Failed account fetches must not
 * collapse into the empty-state login CTA.
 */
export function resolveXaiMediaDetailView({ loaded, error, hasXaiNative, hasBorrowed } = {}) {
  if (!loaded) {
    return {
      phase: "loading",
      showEmpty: false,
      showConnectionsCard: false,
      showBorrowed: false,
      showError: false,
    };
  }
  if (error) {
    return {
      phase: "error",
      showEmpty: false,
      showConnectionsCard: true,
      showBorrowed: !!hasBorrowed,
      showError: true,
    };
  }
  if (!hasXaiNative && !hasBorrowed) {
    return {
      phase: "empty",
      showEmpty: true,
      showConnectionsCard: false,
      showBorrowed: false,
      showError: false,
    };
  }
  return {
    phase: "ready",
    showEmpty: false,
    showConnectionsCard: !!hasXaiNative,
    showBorrowed: !!hasBorrowed,
    showError: false,
  };
}

export function normalizeImaginePlanName(value) {
  if (value == null) return "";
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function isImagineTierRestrictedClient(connection) {
  const tier = connection?.providerSpecificData?.subscriptionTier
    || connection?.subscriptionTier
    || connection?.normalizedPlan;
  const plan = normalizeImaginePlanName(tier);
  return plan === "free" || plan === "x basic";
}

function getEffectiveStatus(conn) {
  const isCooldown = Object.entries(conn || {}).some(
    ([k, v]) => k.startsWith("modelLock_") && v && new Date(v).getTime() > Date.now()
  );
  return conn?.testStatus === "unavailable" && !isCooldown ? "active" : conn?.testStatus;
}

export function isUsableGrokCliMediaConnection(conn) {
  if (!conn || conn.provider !== "grok-cli") return false;
  if (conn.isActive === false) return false;
  if (conn.authType && conn.authType !== "oauth") return false;
  return !isImagineTierRestrictedClient(conn);
}

/**
 * Badge/subtitle for the xAI card on image/video media lists.
 * Connected counts only real xai rows.
 */
export function summarizeXaiMediaCard({ xaiConnections = [], grokCliConnections = [] } = {}) {
  const xaiTotal = xaiConnections.length;
  const xaiEnabled = xaiConnections.filter((c) => c.isActive !== false);
  const allXaiDisabled = xaiTotal > 0 && xaiConnections.every((c) => c.isActive === false);
  const xaiConnectedCount = xaiEnabled.filter((c) => {
    const s = getEffectiveStatus(c);
    return s === "active" || s === "success";
  }).length;

  const grokCliReady = grokCliConnections.filter(isUsableGrokCliMediaConnection);
  const grokCliRestricted = grokCliConnections.filter((c) => {
    if (c.isActive === false) return false;
    if (c.authType && c.authType !== "oauth") return false;
    return isImagineTierRestrictedClient(c);
  });

  const hasBorrowedReady = grokCliReady.length > 0;
  const onlyRestrictedBorrow = !hasBorrowedReady && grokCliRestricted.length > 0 && xaiTotal === 0;

  if (onlyRestrictedBorrow) {
    return {
      xaiConnectedCount,
      grokCliReadyCount: 0,
      grokCliRestrictedCount: grokCliRestricted.length,
      badge: "restricted",
      subtitle: null,
      showToggle: false,
      dimmed: false,
    };
  }

  if (xaiTotal === 0 && hasBorrowedReady) {
    return {
      xaiConnectedCount: 0,
      grokCliReadyCount: grokCliReady.length,
      grokCliRestrictedCount: grokCliRestricted.length,
      badge: "ready-borrowed",
      subtitle: "Uses Grok Build login",
      showToggle: false,
      dimmed: false,
    };
  }

  if (allXaiDisabled && hasBorrowedReady) {
    return {
      xaiConnectedCount: 0,
      grokCliReadyCount: grokCliReady.length,
      grokCliRestrictedCount: grokCliRestricted.length,
      badge: "ready-borrowed",
      subtitle: "Uses Grok Build login",
      showToggle: true,
      dimmed: false,
    };
  }

  if (allXaiDisabled) {
    return {
      xaiConnectedCount: 0,
      grokCliReadyCount: grokCliReady.length,
      grokCliRestrictedCount: grokCliRestricted.length,
      badge: "disabled",
      subtitle: null,
      showToggle: true,
      dimmed: true,
    };
  }

  if (xaiTotal === 0) {
    return {
      xaiConnectedCount: 0,
      grokCliReadyCount: 0,
      grokCliRestrictedCount: grokCliRestricted.length,
      badge: "none",
      subtitle: null,
      showToggle: false,
      dimmed: false,
    };
  }

  if (xaiConnectedCount > 0) {
    return {
      xaiConnectedCount,
      grokCliReadyCount: grokCliReady.length,
      grokCliRestrictedCount: grokCliRestricted.length,
      badge: "connected",
      subtitle: hasBorrowedReady ? "Also uses Grok Build login" : null,
      showToggle: true,
      dimmed: false,
    };
  }

  return {
    xaiConnectedCount: 0,
    grokCliReadyCount: grokCliReady.length,
    grokCliRestrictedCount: grokCliRestricted.length,
    badge: "added",
    subtitle: hasBorrowedReady ? "Also uses Grok Build login" : null,
    showToggle: true,
    dimmed: false,
  };
}
