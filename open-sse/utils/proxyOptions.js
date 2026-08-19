/**
 * Build proxyAwareFetch options from a *resolved* providerSpecificData object.
 * Never pass a raw connection row — it has no connectionProxyEnabled column.
 */
export function proxyOptionsFrom(psd = {}) {
  const enabled = psd.connectionProxyEnabled === true && !!psd.connectionProxyUrl;
  return {
    connectionProxyEnabled: enabled,
    connectionProxyUrl: psd.connectionProxyUrl || "",
    connectionNoProxy: psd.connectionNoProxy || "",
    vercelRelayUrl: psd.vercelRelayUrl || "",
    strictProxy: enabled,
  };
}

export function proxyErrorMessage(proxyOptions, cause) {
  let hostPort = "proxy";
  const raw = proxyOptions?.connectionProxyUrl || "";
  try {
    const parsed = new URL(raw);
    hostPort = `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
  } catch {
    // keep generic
  }
  const detail = cause?.message ? ` ${cause.message}` : "";
  return `Could not reach the upstream via the connection proxy (${hostPort}). Check that the proxy is running.${detail ? ` ${detail}` : ""}`;
}
