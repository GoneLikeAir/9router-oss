"use client";

import { useParams, notFound, useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useEffect } from "react";
import { Card, Badge, Button, AddCustomEmbeddingModal, NoAuthProxyCard, ProviderInfoCard } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { MEDIA_PROVIDER_KINDS, AI_PROVIDERS, isCustomEmbeddingProvider, isOpenAICompatibleProvider } from "@/shared/constants/providers";
import { ConfirmModal } from "@/shared/components";
import EditCompatibleNodeModal from "@/app/(dashboard)/dashboard/providers/[id]/EditCompatibleNodeModal";
import ConnectionsCard from "@/app/(dashboard)/dashboard/providers/components/ConnectionsCard";
import ModelsCard from "@/app/(dashboard)/dashboard/providers/components/ModelsCard";
import { KIND_EXAMPLE_CONFIG } from "./components/exampleShared";
import { EmbeddingExampleCard } from "./components/EmbeddingExampleCard";
import { TtsExampleCard } from "./components/TtsExampleCard";
import { GenericExampleCard } from "./components/GenericExampleCard";
import { SttExampleCard } from "./components/SttExampleCard";
import { BorrowedGrokBuildAccounts } from "./components/BorrowedGrokBuildAccounts";
import { XaiMediaEmptyState } from "./components/XaiMediaEmptyState";
import { resolveXaiMediaDetailView } from "../xaiMediaStatus";

// MediaProviderDetailPage
export default function MediaProviderDetailPage() {
  const { kind, id } = useParams();
  const router = useRouter();
  const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kind);
  const maybeCompat = isOpenAICompatibleProvider(id) && kind === "image";
  const isCustomEmbedding = isCustomEmbeddingProvider(id) && kind === "embedding";
  const [pendingDelete, setPendingDelete] = useState(false);

  const handleDeleteCustom = async () => {
    if (isCustomEmbedding && !confirm("Delete this Custom Embedding node?")) return;
    try {
      const res = await fetch(`/api/provider-nodes/${id}`, { method: "DELETE" });
      if (res.ok) router.push(`/dashboard/media-providers/${kind}`);
    } catch (error) {
      console.log("Error deleting custom embedding node:", error);
    }
  };

  const [customNode, setCustomNode] = useState(null);
  const [customLoading, setCustomLoading] = useState(isCustomEmbedding || maybeCompat);
  const [showEditModal, setShowEditModal] = useState(false);
  const [xaiMediaAccounts, setXaiMediaAccounts] = useState([]);
  const [xaiMediaLoaded, setXaiMediaLoaded] = useState(false);
  const [xaiMediaError, setXaiMediaError] = useState(null);
  const isXaiMedia = id === "xai" && (kind === "image" || kind === "video");

  useEffect(() => {
    if (!isXaiMedia) {
      setXaiMediaLoaded(true);
      setXaiMediaError(null);
      return;
    }
    let cancelled = false;
    setXaiMediaLoaded(false);
    setXaiMediaError(null);
    fetch(`/api/media-providers/accounts?kind=${encodeURIComponent(kind)}&provider=xai`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        return d;
      })
      .then((d) => {
        if (cancelled) return;
        setXaiMediaAccounts(d.accounts || []);
        setXaiMediaError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setXaiMediaError(err?.message || "Failed to load accounts");
      })
      .finally(() => {
        if (!cancelled) setXaiMediaLoaded(true);
      });
    return () => { cancelled = true; };
  }, [isXaiMedia, kind]);

  // Fetch custom node info from API for custom embedding nodes
  useEffect(() => {
    if (!isCustomEmbedding && !maybeCompat) return;
    let cancelled = false;
    fetch("/api/provider-nodes", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setCustomNode((d.nodes || []).find((n) => n.id === id) || null);
        setCustomLoading(false);
      })
      .catch(() => { if (!cancelled) setCustomLoading(false); });
    return () => { cancelled = true; };
  }, [id, isCustomEmbedding, maybeCompat]);

  if (!kindConfig) return notFound();

  const builtInProvider = AI_PROVIDERS[id];
  const isCustomImage = kind === "image" && (
    (typeof id === "string" && id.startsWith("openai-compatible-images-"))
    || customNode?.apiType === "images"
  );
  const isCustom = isCustomEmbedding || isCustomImage;

  // For custom nodes, build a synthetic provider object
  const provider = isCustom
    ? (customNode ? {
      id,
      name: customNode.name || (isCustomImage ? "Custom Images" : "Custom Embedding"),
      color: "#6366F1",
      textIcon: (customNode.prefix || "CE").slice(0, 2).toUpperCase(),
    } : null)
    : builtInProvider;

  if (!builtInProvider && !maybeCompat && !isCustomEmbedding) return notFound();
  if ((maybeCompat || isCustomEmbedding) && customLoading) {
    return <div className="text-text-muted text-sm py-12 text-center">Loading...</div>;
  }
  if (isCustom && !customNode) return notFound();
  if (maybeCompat && !isCustomImage) return notFound();

  const kinds = isCustomImage ? ["image"] : isCustomEmbedding ? ["embedding"] : (provider.serviceKinds ?? ["llm"]);
  if (!isCustom && !kinds.includes(kind)) return notFound();

  const xaiNativeAccounts = isXaiMedia
    ? xaiMediaAccounts.filter((a) => a.sourceProvider === "xai")
    : [];
  const borrowedAccounts = isXaiMedia
    ? xaiMediaAccounts.filter((a) => a.sourceProvider === "grok-cli")
    : [];
  const hasXaiNative = xaiNativeAccounts.length > 0;
  const hasBorrowed = borrowedAccounts.length > 0;
  const xaiDetailView = resolveXaiMediaDetailView({
    loaded: xaiMediaLoaded,
    error: xaiMediaError,
    hasXaiNative,
    hasBorrowed,
  });
  const apiKeyLabel = isXaiMedia && hasBorrowed
    ? "Optional: add a console.x.ai API key"
    : "Get API Key";

  return (
    <div className="flex flex-col gap-8">
      {/* Back */}
      <div>
        <Link
          href={`/dashboard/media-providers/${kind}`}
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary transition-colors mb-4"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          {kindConfig.label}
        </Link>

        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="size-12 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${provider.color}15` }}>
            <ProviderIcon
              src={`/providers/${provider.id}.png`}
              alt={provider.name}
              size={48}
              className="object-contain rounded-lg max-w-[48px] max-h-[48px]"
              fallbackText={provider.textIcon || provider.id.slice(0, 2).toUpperCase()}
              fallbackColor={provider.color}
            />
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <h1 className="text-3xl font-semibold tracking-tight">{provider.name}</h1>
              {!isCustom && provider.notice?.apiKeyUrl && (
                <a
                  href={provider.notice.apiKeyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-sm">open_in_new</span>
                  {apiKeyLabel}
                </a>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {isCustom && <Badge variant="default" size="sm">Custom · {customNode?.prefix}</Badge>}
              {isCustomImage && (
                <Link href={`/dashboard/providers/${id}`} className="text-xs text-primary hover:underline">
                  Open in Providers
                </Link>
              )}
              {kinds.map((k) => (
                <Badge key={k} variant={k === kind ? "primary" : "default"} size="sm">
                  {k.toUpperCase()}
                </Badge>
              ))}
            </div>
          </div>
          {isCustom && (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <Button size="sm" variant="secondary" icon="edit" onClick={() => setShowEditModal(true)}>
                Edit
              </Button>
              <Button size="sm" variant="secondary" icon="delete" onClick={() => (isCustomImage ? setPendingDelete(true) : handleDeleteCustom())}>
                Delete
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Kind-specific notice (e.g. codex/image requires Plus) */}
      {!isCustom && provider.kindNotice?.[kind] && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400">
          <span className="material-symbols-outlined text-[20px] mt-0.5">warning</span>
          <p className="text-sm">{provider.kindNotice[kind]}</p>
        </div>
      )}

      {/* Provider notice text (only when there's actual text content) */}
      {!isCustom && provider.notice?.text && !provider.deprecated && (
        <div className="flex flex-col gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 sm:flex-row sm:items-center">
          <span className="material-symbols-outlined text-[16px] text-blue-500 shrink-0">info</span>
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-blue-600 dark:text-blue-400">{provider.notice.text}</p>
          {provider.notice.apiKeyUrl && (
            <a
              href={provider.notice.apiKeyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex justify-center rounded bg-blue-500 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-600 sm:py-0.5"
            >
              Get API Key →
            </a>
          )}
        </div>
      )}

      {/* Connections */}
      {!isCustom && provider.noAuth ? (
        <NoAuthProxyCard providerId={id} />
      ) : isXaiMedia && xaiDetailView.phase === "loading" ? (
        <div className="text-text-muted text-sm py-6">Loading accounts…</div>
      ) : xaiDetailView.showEmpty ? (
        <XaiMediaEmptyState kind={kind} />
      ) : isXaiMedia ? (
        <>
          {xaiDetailView.showError && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
              <p>Could not load Grok Build media accounts. Existing xAI connections are still shown below.</p>
            </div>
          )}
          {xaiDetailView.showConnectionsCard && <ConnectionsCard providerId={id} isOAuth={false} />}
          {xaiDetailView.showBorrowed && <BorrowedGrokBuildAccounts accounts={borrowedAccounts} />}
          {xaiDetailView.phase === "ready" && !hasXaiNative && hasBorrowed && (
            <div className="text-xs text-text-muted">
              <Link href="/dashboard/providers/xai" className="text-primary hover:underline">
                Add xAI API Key
              </Link>
            </div>
          )}
        </>
      ) : (
        <ConnectionsCard providerId={id} isOAuth={false} />
      )}

      {/* Models - hidden for tts/webSearch/webFetch (provider IS the model); custom uses prefix as alias */}
      {kind !== "tts" && kind !== "webSearch" && kind !== "webFetch" && (
        <ModelsCard
          providerId={id}
          kindFilter={kind}
          providerAliasOverride={isCustom ? customNode?.prefix : undefined}
        />
      )}

      {/* Provider Info — config-driven, supports searchConfig, fetchConfig, ttsConfig, embeddingConfig, searchViaChat */}
      {!isCustom && (provider.searchConfig || provider.fetchConfig || provider.ttsConfig || provider.sttConfig || provider.embeddingConfig || provider.searchViaChat) && (
        <ProviderInfoCard
          config={
            kind === "webFetch" ? provider.fetchConfig
              : kind === "tts" ? provider.ttsConfig
              : kind === "stt" ? provider.sttConfig
              : kind === "embedding" ? provider.embeddingConfig
              : provider.searchConfig || { mode: "chat-completions", defaultModel: provider.searchViaChat?.defaultModel, pricingUrl: provider.searchViaChat?.pricingUrl, freeTier: provider.searchViaChat?.freeTier }
          }
          provider={provider}
          title={`${kindConfig.label} Config`}
        />
      )}

      {/* Example — per kind */}
      {kind === "embedding" && (
        <EmbeddingExampleCard providerId={id} customAlias={customNode?.prefix} />
      )}
      {kind === "tts" && <TtsExampleCard providerId={id} />}
      {kind === "stt" && !isCustom && <SttExampleCard providerId={id} />}
      {((!isCustom && KIND_EXAMPLE_CONFIG[kind]) || isCustomImage) && (
        <GenericExampleCard
          providerId={id}
          kind={kind}
          customAlias={isCustomImage ? customNode?.prefix : undefined}
          imageCapabilities={isCustomImage ? customNode?.imageCapabilities : undefined}
        />
      )}

      {isCustomEmbedding && (
        <AddCustomEmbeddingModal
          isOpen={showEditModal}
          node={customNode}
          onClose={() => setShowEditModal(false)}
          onSaved={(updated) => {
            setCustomNode(updated);
            setShowEditModal(false);
          }}
        />
      )}
      {isCustomImage && (
        <EditCompatibleNodeModal
          isOpen={showEditModal}
          node={customNode}
          onClose={() => setShowEditModal(false)}
          onSave={async (payload) => {
            const res = await fetch(`/api/provider-nodes/${id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.node) setCustomNode(data.node);
            setShowEditModal(false);
          }}
        />
      )}
      {isCustomImage && (
        <ConfirmModal
          isOpen={pendingDelete}
          title="Delete Images node?"
          confirmText="Delete"
          message={`Delete “${customNode?.name}”? This removes the node and its connections. Usage history is kept. This cannot be undone.`}
          onClose={() => setPendingDelete(false)}
          onConfirm={async () => {
            setPendingDelete(false);
            await handleDeleteCustom();
          }}
        />
      )}
    </div>
  );
}
