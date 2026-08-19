"use client";

import { useParams, notFound, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, CardSkeleton, Badge, Button, Toggle, AddCustomEmbeddingModal } from "@/shared/components";
import AddCompatibleModal from "@/app/(dashboard)/dashboard/providers/components/AddCompatibleModal";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { MEDIA_PROVIDER_KINDS, AI_PROVIDERS, getProvidersByKind } from "@/shared/constants/providers";
import { summarizeXaiMediaCard } from "./xaiMediaStatus";

// Kinds that support combos (currently disabled for image/tts — temporarily hidden).
// webSearch/webFetch handled by /web page.
const COMBO_KINDS = new Set([]);
const COMBO_BASE_NAMES = { image: "image-combo", tts: "tts-combo" };

function getEffectiveStatus(conn) {
  const isCooldown = Object.entries(conn).some(
    ([k, v]) => k.startsWith("modelLock_") && v && new Date(v).getTime() > Date.now()
  );
  return conn.testStatus === "unavailable" && !isCooldown ? "active" : conn.testStatus;
}

function MediaProviderCard({ provider, kind, connections, isCustom, onToggle }) {
  const providerInfo = AI_PROVIDERS[provider.id];
  const isNoAuth = !!providerInfo?.noAuth;
  const isXaiMedia = provider.id === "xai" && (kind === "image" || kind === "video");

  const providerConns = connections.filter((c) => c.provider === provider.id);
  const grokCliConns = isXaiMedia ? connections.filter((c) => c.provider === "grok-cli") : [];
  const xaiSummary = isXaiMedia
    ? summarizeXaiMediaCard({ xaiConnections: providerConns, grokCliConnections: grokCliConns })
    : null;

  const connected = providerConns.filter((c) => { const s = getEffectiveStatus(c); return s === "active" || s === "success"; }).length;
  const error = providerConns.filter((c) => { const s = getEffectiveStatus(c); return s === "error" || s === "expired" || s === "unavailable"; }).length;
  const total = providerConns.length;
  const allDisabled = total > 0 && providerConns.every((c) => c.isActive === false);
  const showToggle = xaiSummary ? xaiSummary.showToggle : total > 0;
  const dimmed = xaiSummary ? xaiSummary.dimmed : allDisabled;

  const handleToggleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (onToggle) onToggle(provider.id, allDisabled);
  };

  const renderStatus = () => {
    if (isNoAuth) return <Badge variant="success" size="sm">Ready</Badge>;
    if (xaiSummary) {
      if (xaiSummary.badge === "restricted") {
        return <Badge variant="warning" size="sm">Imagine not included</Badge>;
      }
      if (xaiSummary.badge === "ready-borrowed") {
        return (
          <>
            <Badge variant="success" size="sm">Ready</Badge>
            <span className="text-xs text-text-muted">{xaiSummary.subtitle}</span>
          </>
        );
      }
      if (xaiSummary.badge === "disabled") return <Badge variant="default" size="sm">Disabled</Badge>;
      if (xaiSummary.badge === "none") return <span className="text-xs text-text-muted">No connections</span>;
      return (
        <>
          {xaiSummary.badge === "connected" && (
            <Badge variant="success" size="sm" dot>{xaiSummary.xaiConnectedCount} Connected</Badge>
          )}
          {xaiSummary.badge === "added" && (
            <Badge variant="default" size="sm">{total} Added</Badge>
          )}
          {error > 0 && <Badge variant="error" size="sm" dot>{error} Error</Badge>}
          {xaiSummary.subtitle && <span className="text-xs text-text-muted">{xaiSummary.subtitle}</span>}
        </>
      );
    }
    if (allDisabled) return <Badge variant="default" size="sm">Disabled</Badge>;
    if (total === 0) return <span className="text-xs text-text-muted">No connections</span>;
    return (
      <>
        {connected > 0 && <Badge variant="success" size="sm" dot>{connected} Connected</Badge>}
        {error > 0 && <Badge variant="error" size="sm" dot>{error} Error</Badge>}
        {connected === 0 && error === 0 && <Badge variant="default" size="sm">{total} Added</Badge>}
      </>
    );
  };

  return (
    <Link href={`/dashboard/media-providers/${kind}/${provider.id}`} className="group">
      <Card
        padding="xs"
        className={`h-full hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors cursor-pointer ${dimmed ? "opacity-50" : ""}`}
      >
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="size-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${provider.color?.length > 7 ? provider.color : (provider.color ?? "#888") + "15"}` }}
            >
              <ProviderIcon
                src={`/providers/${provider.id}.png`}
                alt={provider.name}
                size={30}
                className="object-contain rounded-lg max-w-[30px] max-h-[30px]"
                fallbackText={provider.textIcon || provider.id.slice(0, 2).toUpperCase()}
                fallbackColor={provider.color}
              />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-sm">{provider.name}</h3>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                {isCustom && <Badge variant="default" size="sm">Custom</Badge>}
                {renderStatus()}
              </div>
            </div>
          </div>
          {showToggle && (
            <div
              className="shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
              onClick={handleToggleClick}
            >
              <Toggle
                size="sm"
                checked={!allDisabled}
                onChange={() => {}}
                title={allDisabled ? "Enable provider" : "Disable provider"}
              />
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}

function ComboList({ combos }) {
  if (combos.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {combos.map((combo) => (
        <Link key={combo.id} href={`/dashboard/media-providers/combo/${combo.id}`}>
          <Card padding="xs" className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer">
            <div className="flex min-w-0 items-center gap-3">
              <span className="material-symbols-outlined text-primary text-[18px]">layers</span>
              <code className="text-sm font-mono font-medium flex-1 truncate">{combo.name}</code>
              <div className="flex flex-wrap items-center gap-1 sm:shrink-0">
                {combo.models.slice(0, 6).map((entry, i) => {
                  const pid = typeof entry === "string" ? entry.split("/")[0] : "";
                  const p = AI_PROVIDERS[pid];
                  return (
                    <div key={`${entry}-${i}`} title={p?.name || entry} className="size-5 rounded flex items-center justify-center" style={{ backgroundColor: `${(p?.color ?? "#888")}15` }}>
                      <ProviderIcon
                        src={`/providers/${pid}.png`}
                        alt={p?.name || pid}
                        size={18}
                        className="object-contain rounded max-w-[18px] max-h-[18px]"
                        fallbackText={p?.textIcon || pid.slice(0, 2).toUpperCase()}
                        fallbackColor={p?.color}
                      />
                    </div>
                  );
                })}
                {combo.models.length > 6 && (
                  <span className="text-[10px] text-text-muted ml-1">+{combo.models.length - 6}</span>
                )}
              </div>
              <span className="text-[11px] text-text-muted shrink-0">{combo.models.length}</span>
              <span className="material-symbols-outlined text-text-muted text-[16px]">chevron_right</span>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}

export default function MediaProviderKindPage() {
  const { kind } = useParams();
  const router = useRouter();
  const [connections, setConnections] = useState([]);
  const [customNodes, setCustomNodes] = useState([]);
  const [combos, setCombos] = useState([]);
  const [showAddCustomEmbedding, setShowAddCustomEmbedding] = useState(false);
  const [showAddImagesNode, setShowAddImagesNode] = useState(false);
  const [nodesError, setNodesError] = useState("");
  const [connectionsError, setConnectionsError] = useState("");
  const [listLoading, setListLoading] = useState(true);

  // webSearch/webFetch listing pages are merged into /web
  useEffect(() => {
    if (kind === "webSearch" || kind === "webFetch") {
      router.replace("/dashboard/media-providers/web");
    }
  }, [kind, router]);

  const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kind);
  const isEmbedding = kind === "embedding";
  const isImage = kind === "image";
  const supportsCombo = COMBO_KINDS.has(kind);

  useEffect(() => {
    if (!kindConfig) return;
    setListLoading(true);
    fetch("/api/providers", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { setConnections(d.connections || []); setConnectionsError(""); })
      .catch((err) => setConnectionsError(err?.message || "Failed to load connections"))
      .finally(() => { if (!isEmbedding && !isImage) setListLoading(false); });
    if (isEmbedding || isImage) {
      fetch("/api/provider-nodes", { cache: "no-store" })
        .then(async (r) => {
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
          return d;
        })
        .then((d) => {
          const nodes = d.nodes || [];
          setCustomNodes(nodes.filter((n) => {
            if (isEmbedding) return n.type === "custom-embedding";
            return n.apiType === "images" || (typeof n.id === "string" && n.id.startsWith("openai-compatible-images-"));
          }));
          setNodesError("");
        })
        .catch((err) => setNodesError(err?.message || "Failed to load nodes"))
        .finally(() => setListLoading(false));
    }
    if (supportsCombo) {
      fetch("/api/combos", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => setCombos(d.combos || []))
        .catch(() => {});
    }
  }, [isEmbedding, isImage, supportsCombo, kindConfig]);

  if (!kindConfig) return notFound();

  const providers = getProvidersByKind(kind);
  const kindCombos = combos.filter((c) => c.kind === kind);

  // Map custom nodes to MediaProviderCard shape
  const customProviders = customNodes.map((n) => ({
    id: n.id,
    name: n.name || (isImage ? "Custom Images" : "Custom Embedding"),
    color: "#6366F1",
    textIcon: (n.prefix || "CE").slice(0, 2).toUpperCase(),
  }));

  const allProviders = [...providers, ...customProviders];

  const handleToggleProvider = async (providerId, newActive) => {
    const providerConns = connections.filter((c) => c.provider === providerId);
    setConnections((prev) =>
      prev.map((c) => (c.provider === providerId ? { ...c, isActive: newActive } : c))
    );
    await Promise.allSettled(
      providerConns.map((c) =>
        fetch(`/api/providers/${c.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: newActive }),
        })
      )
    );
  };

  const handleCreateCombo = async () => {
    const base = COMBO_BASE_NAMES[kind] || `${kind}-combo`;
    let name = base;
    let i = 1;
    const existing = new Set(combos.map((c) => c.name));
    while (existing.has(name)) { name = `${base}-${i++}`; }
    const res = await fetch("/api/combos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, models: [], kind }),
    });
    if (res.ok) {
      const created = await res.json();
      router.push(`/dashboard/media-providers/combo/${created.id}`);
    } else {
      const err = await res.json();
      alert(err.error || "Failed to create combo");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {(isEmbedding || isImage || supportsCombo) && (
        <div className="flex items-center justify-end gap-2">
          {supportsCombo && (
            <Button size="sm" icon="add" onClick={handleCreateCombo}>Create Combo</Button>
          )}
          {isEmbedding && (
            <Button size="sm" icon="add" onClick={() => setShowAddCustomEmbedding(true)}>
              Add Custom Embedding
            </Button>
          )}
          {isImage && (
            <Button size="sm" icon="add" onClick={() => setShowAddImagesNode(true)}>
              Add Images node
            </Button>
          )}
        </div>
      )}
      {nodesError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">
          Could not load Images nodes: {nodesError}
        </div>
      )}
      {connectionsError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">
          Could not load connections: {connectionsError}
        </div>
      )}

      {supportsCombo && kindCombos.length > 0 && (
        <ComboList combos={kindCombos} />
      )}

      {listLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : allProviders.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-xl text-text-muted text-sm">
          No providers support <strong>{kindConfig.label}</strong> yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {providers.map((provider) => (
            <MediaProviderCard
              key={provider.id}
              provider={provider}
              kind={kind}
              connections={connections}
              onToggle={handleToggleProvider}
            />
          ))}
          {customProviders.map((provider) => (
            <MediaProviderCard
              key={provider.id}
              provider={provider}
              kind={kind}
              connections={connections}
              isCustom
              onToggle={handleToggleProvider}
            />
          ))}
        </div>
      )}

      {isEmbedding && (
        <AddCustomEmbeddingModal
          isOpen={showAddCustomEmbedding}
          onClose={() => setShowAddCustomEmbedding(false)}
          onCreated={(node) => {
            setCustomNodes((prev) => [...prev, node]);
            setShowAddCustomEmbedding(false);
          }}
        />
      )}
      {isImage && (
        <AddCompatibleModal
          variant="openai"
          isOpen={showAddImagesNode}
          initialApiType="images"
          onClose={() => setShowAddImagesNode(false)}
          onCreated={(node) => {
            setCustomNodes((prev) => [...prev, node]);
            setShowAddImagesNode(false);
            if (node?.id) router.push(`/dashboard/providers/${node.id}`);
          }}
        />
      )}
    </div>
  );
}
