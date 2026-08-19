"use client";

import { useState, useEffect } from "react";
import { Card } from "@/shared/components";
import { MEDIA_PROVIDER_KINDS, getProviderAlias, resolveProviderId } from "@/shared/constants/providers";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { Row, KIND_EXAMPLE_CONFIG } from "./exampleShared";
import {
  extraBodyFromXaiFields,
  getXaiImageExtraFields,
  getXaiQualityField,
  XAI_FILE_ID_RE,
  xaiExampleFlags,
} from "./xaiExampleFlags";

const TXT2IMG_DEFAULT = "A cute cat wearing a hat";
const IMG2IMG_DEFAULT = "Turn this into a pencil sketch";
const DASH_IMAGE_ERR = "Images must be PNG, JPEG, or WebP, max 20 MB.";

const CLOUDFLARE_TEST_IMAGE_URL = "https://pub-1fb693cb11cc46b2b2f656f51e015a2c.r2.dev/dog.png";
const CLOUDFLARE_TEST_MASK_URL = "https://pub-1fb693cb11cc46b2b2f656f51e015a2c.r2.dev/dog-mask.png";

function getImageEditDefaults(providerId, modelId) {
  if (providerId !== "cloudflare-ai") return {};
  if (modelId === "@cf/runwayml/stable-diffusion-v1-5-img2img") {
    return { image: CLOUDFLARE_TEST_IMAGE_URL };
  }
  if (modelId === "@cf/runwayml/stable-diffusion-v1-5-inpainting") {
    return { image: CLOUDFLARE_TEST_IMAGE_URL, mask_image: CLOUDFLARE_TEST_MASK_URL };
  }
  return {};
}

function toImagePreviewSrc(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return "";
  if (XAI_FILE_ID_RE.test(trimmed)) return "";
  if (/^(data:image\/|https?:\/\/)/i.test(trimmed)) return trimmed;
  return `data:image/png;base64,${trimmed}`;
}

function collapseImageValue(value) {
  if (typeof value === "string" && (value.startsWith("data:") || value.length > 120)) return "<image-data>";
  return value;
}

function optionValue(opt) {
  return typeof opt === "object" && opt != null ? opt.value : opt;
}

function optionLabel(opt) {
  if (typeof opt === "object" && opt != null) return opt.label;
  return opt === "" ? "(default)" : opt;
}

export function GenericExampleCard({ providerId, kind, customAlias, imageCapabilities }) {
  const providerAlias = customAlias || getProviderAlias(providerId);
  const resolvedId = resolveProviderId(providerAlias);
  const safeProviderAlias = customAlias || (resolvedId === providerId ? providerAlias : providerId);
  const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kind);
  const exConfig = KIND_EXAMPLE_CONFIG[kind];
  const safeExConfig = exConfig || {};

  const staticKindModels = getModelsByProviderId(providerId).filter((m) => getModelKind(m) === kind);
  const [liveModels, setLiveModels] = useState(null);
  const [liveModelsError, setLiveModelsError] = useState("");
  const [liveModelsLoading, setLiveModelsLoading] = useState(!!customAlias);
  const kindModels = liveModels || staticKindModels;
  // Kinds that need a model identifier in the request (image/video/music)
  const KIND_NEEDS_MODEL = new Set(["image", "video", "music", "imageToText"]);
  const needsModel = KIND_NEEDS_MODEL.has(kind);
  const allowManualModel = needsModel && kindModels.length === 0;
  const [selectedModel, setSelectedModel] = useState(kindModels[0]?.id ?? "");
  const selectedModelObj = kindModels.find((m) => m.id === selectedModel);
  const [mode, setMode] = useState("txt2img");
  const [fileError, setFileError] = useState("");
  const [nextInputHint, setNextInputHint] = useState("");

  const [input, setInput] = useState(safeExConfig.defaultInput || "");
  const [refImage, setRefImage] = useState("");
  const [refSlots, setRefSlots] = useState([""]);
  const [maskImage, setMaskImage] = useState("");
  const [extraValues, setExtraValues] = useState(() => {
    if (providerId === "xai" && kind === "image") {
      return { n: 1, aspect_ratio: "auto", resolution: "" };
    }
    const init = (safeExConfig.extraFields || []).reduce((acc, f) => { acc[f.key] = f.default ?? ""; return acc; }, {});
    if (customAlias && kind === "image") init.quality = "low";
    return init;
  });
  const [apiKey, setApiKey] = useState("");
  const [useTunnel, setUseTunnel] = useState(false);
  const [localEndpoint, setLocalEndpoint] = useState("");
  const [tunnelEndpoint, setTunnelEndpoint] = useState("");
  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState(null); // { stage, bytesReceived }
  const [partialImage, setPartialImage] = useState(null);
  const [imageOutputFormat, setImageOutputFormat] = useState("json"); // json | binary
  const [binaryImageUrl, setBinaryImageUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [connections, setConnections] = useState([]);
  const [pinnedConnectionId, setPinnedConnectionId] = useState("");
  const { copied: copiedCurl, copy: copyCurl } = useCopyToClipboard();
  const { copied: copiedRes, copy: copyRes } = useCopyToClipboard();

  useEffect(() => {
    setLocalEndpoint(window.location.origin);
    fetch("/api/keys")
      .then((r) => r.json())
      .then((d) => { setApiKey((d.keys || []).find((k) => k.isActive !== false)?.key || ""); })
      .catch(() => {});
    fetch("/api/tunnel/status")
      .then((r) => r.json())
      .then((d) => { if (d.publicUrl) setTunnelEndpoint(d.publicUrl); })
      .catch(() => {});
    const isXaiMedia = providerId === "xai" && (kind === "image" || kind === "video");
    if (isXaiMedia) {
      fetch(`/api/media-providers/accounts?kind=${encodeURIComponent(kind)}&provider=xai`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          const conns = (d.accounts || [])
            .filter((c) => c.isActive !== false && !c.tierRestricted)
            .map((c) => ({
              id: c.id,
              email: c.email,
              name: c.sourceProvider === "grok-cli"
                ? `Grok Build · ${c.email || c.displayName || c.name}`
                : (c.email || c.displayName || c.name),
              provider: c.sourceProvider,
            }));
          setConnections(conns);
        })
        .catch(() => {});
      return;
    }
    // Load active connections of this provider for pinning
    fetch("/api/providers/client")
      .then((r) => r.json())
      .then((d) => {
        const conns = (d.connections || []).filter((c) => c.provider === providerId && c.isActive !== false);
        setConnections(conns);
      })
      .catch(() => {});
  }, [providerId, kind]);

  useEffect(() => {
    if (!customAlias || kind !== "image") return;
    let cancelled = false;
    setLiveModelsLoading(true);
    fetch("/api/v1/models/image", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error?.message || d.error || `HTTP ${r.status}`);
        return d;
      })
      .then((d) => {
        if (cancelled) return;
        const models = (d.data || [])
          .filter((m) => m.owned_by === customAlias || String(m.id || "").startsWith(`${customAlias}/`))
          .map((m) => ({ id: String(m.id).includes("/") ? String(m.id).slice(customAlias.length + 1) : m.id }));
        setLiveModels(models);
        setLiveModelsError("");
        if (models[0]?.id) setSelectedModel((prev) => prev || models[0].id);
      })
      .catch((err) => {
        if (cancelled) return;
        setLiveModels([]);
        setLiveModelsError(err.message || "Could not list models");
      })
      .finally(() => { if (!cancelled) setLiveModelsLoading(false); });
    return () => { cancelled = true; };
  }, [customAlias, kind]);

  useEffect(() => {
    if (providerId !== "xai" || kind !== "image") return;
    setExtraValues((prev) => {
      const next = { ...prev };
      if (selectedModel === "grok-imagine-image-2.0") {
        if (next.quality == null || next.quality === "" || next.quality === "auto") next.quality = "medium";
      } else {
        delete next.quality;
      }
      return next;
    });
  }, [providerId, kind, selectedModel]);

  // Safe to early-return now that all hooks are declared
  if (!kindConfig || !exConfig) return null;

  const xaiFilledSlots = refSlots.map((s) => s.trim()).filter(Boolean);
  const flags = xaiExampleFlags({
    providerId,
    kind,
    customAlias,
    imageCapabilities,
    selectedModelObj,
    mode,
    effectiveRefImage: xaiFilledSlots[0] || refImage,
  });
  // xAI Imagine edits are JSON-only; do not reuse the custom-node multipart curl.
  const { isXaiImage, showMode, useMultipart, supportsMask, maxRefImages } = flags;
  const supportsEdit = showMode ? mode === "img2img" : !!selectedModelObj?.capabilities?.includes("edit");
  const xaiImg2img = isXaiImage && showMode && mode === "img2img";

  const endpoint = useTunnel ? tunnelEndpoint : localEndpoint;
  const apiPath = (showMode && mode === "img2img") ? "/v1/images/edits" : kindConfig.endpoint.path;
  // webSearch/webFetch: use safeProviderAlias only. Other kinds: append model when present.
  const modelFull = !needsModel
    ? safeProviderAlias
    : (selectedModel ? `${safeProviderAlias}/${selectedModel}` : (allowManualModel ? "" : safeProviderAlias));
  const imageEditDefaults = getImageEditDefaults(providerId, selectedModel);
  const effectiveRefImage = refImage.trim() || imageEditDefaults.image || "";
  const effectiveMaskImage = maskImage.trim() || imageEditDefaults.mask_image || "";
  const refImagePreviewSrc = toImagePreviewSrc(effectiveRefImage);
  const maskImagePreviewSrc = toImagePreviewSrc(effectiveMaskImage);

  // Build request body with optional extra fields (only non-empty values)
  const extraFieldDefs = isXaiImage
    ? [
        ...getXaiImageExtraFields({ mode }),
        ...(selectedModel === "grok-imagine-image-2.0" ? [getXaiQualityField()] : []),
      ]
    : customAlias && kind === "image"
      ? (safeExConfig.extraFields || []).filter((f) => ["n", "size", "quality"].includes(f.key))
      : (safeExConfig.extraFields || []);
  const extraBodyFromFields = isXaiImage
    ? extraBodyFromXaiFields(extraValues, extraFieldDefs)
    : Object.entries(extraValues).reduce((acc, [k, v]) => {
      if (v === "" || v === null || v === undefined) return acc;
      if (typeof v === "number" && Number.isNaN(v)) return acc;
      if (customAlias && kind === "image" && !["n", "size", "quality"].includes(k)) return acc;
      acc[k] = v;
      return acc;
    }, {});
  const xaiRefPayload = (() => {
    if (!xaiImg2img || xaiFilledSlots.length === 0) return {};
    if (xaiFilledSlots.length === 1) return { image: xaiFilledSlots[0] };
    return { images: xaiFilledSlots };
  })();
  // Streaming supported for codex image (Plus/Pro accounts) — disabled when binary output requested
  const wantBinary = kind === "image" && imageOutputFormat === "binary";
  const requestBody = {
    model: modelFull,
    [exConfig.bodyKey]: input,
    ...exConfig.extraBody,
    ...extraBodyFromFields,
    ...(isXaiImage && !wantBinary ? { response_format: "b64_json" } : {}),
    ...(!isXaiImage && supportsEdit && effectiveRefImage ? { image: effectiveRefImage } : {}),
    ...(!isXaiImage && supportsMask && effectiveMaskImage ? { mask_image: effectiveMaskImage } : {}),
    ...xaiRefPayload,
  };
  if (customAlias && kind === "image" && extraBodyFromFields.quality == null && extraValues.quality == null) {
    requestBody.quality = requestBody.quality || "low";
  }
  const useStreaming = kind === "image" && providerId === "codex" && !wantBinary;
  const apiPathWithQuery = `${apiPath}${wantBinary ? "?response_format=binary" : ""}`;
  const headersPreview = `-H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${apiKey || "YOUR_KEY"}"${pinnedConnectionId ? ` \\\n  -H "x-connection-id: ${pinnedConnectionId}"` : ""}${useStreaming ? ` \\\n  -H "Accept: text/event-stream"` : ""}`;
  const curlBody = { ...requestBody };
  curlBody.image = collapseImageValue(curlBody.image);
  if (Array.isArray(curlBody.images)) curlBody.images = curlBody.images.map(collapseImageValue);
  curlBody.mask_image = collapseImageValue(curlBody.mask_image);
  const curlSnippet = useMultipart
    ? `curl -X POST ${endpoint}${apiPathWithQuery} \\\n  -H "Authorization: Bearer ${apiKey || "YOUR_KEY"}" \\\n  -F model=${modelFull} \\\n  -F prompt=${JSON.stringify(input)} \\\n  -F image=@reference.png`
    : `curl -X ${kindConfig.endpoint.method} ${endpoint}${apiPathWithQuery} \\
  ${headersPreview.replace(/\\\n  /g, "\\\n  ")} \\
  -d '${JSON.stringify(curlBody)}'${wantBinary ? " \\\n  --output image.png" : ""}`;

  const missingDashboardKey = kind === "image" && customAlias && !apiKey;
  const img2imgMissingImage = showMode && mode === "img2img" && (
    isXaiImage ? xaiFilledSlots.length === 0 : !effectiveRefImage
  );

  const handleFile = (file, setter) => {
    setFileError("");
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setFileError(DASH_IMAGE_ERR);
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setFileError(DASH_IMAGE_ERR);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setter(String(reader.result || ""));
    reader.readAsDataURL(file);
  };

  const applyResultAsReference = async (item, { replace }) => {
    let value = "";
    if (item?.raw?.b64_json) value = `data:image/png;base64,${item.raw.b64_json}`;
    else if (typeof item?.src === "string" && item.src.startsWith("data:")) value = item.src;
    else if (typeof item?.src === "string" && item.src.startsWith("blob:")) {
      try {
        const blob = await fetch(item.src).then((r) => r.blob());
        value = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch {
        setNextInputHint("Could not copy this image in the browser. Download it and upload the file.");
        return;
      }
    } else {
      setNextInputHint("Could not copy this image in the browser. Download it and upload the file.");
      return;
    }
    if (value.length > 20 * 1024 * 1024 * 1.4) {
      setFileError(DASH_IMAGE_ERR);
      return;
    }
    setMode("img2img");
    if (replace) {
      setRefSlots([value]);
      setNextInputHint("Using this result as the only reference.");
    } else {
      setRefSlots((prev) => {
        const next = [...prev];
        const emptyAt = next.findIndex((s) => !String(s).trim());
        if (emptyAt >= 0) {
          next[emptyAt] = value;
          return next;
        }
        if (next.length >= 3) return prev;
        return [...next, value];
      });
      setNextInputHint("");
    }
  };

  const handleRun = async () => {
    if (!input.trim() || !modelFull) return;
    if (missingDashboardKey || img2imgMissingImage) return;
    const oversized = (isXaiImage ? xaiFilledSlots : [effectiveRefImage]).some(
      (v) => typeof v === "string" && v.startsWith("data:") && v.length > 20 * 1024 * 1024 * 1.4
    );
    if (oversized) {
      setFileError(DASH_IMAGE_ERR);
      return;
    }
    setRunning(true);
    setError("");
    setResult(null);
    setProgress(null);
    setPartialImage(null);
    if (binaryImageUrl) { try { URL.revokeObjectURL(binaryImageUrl); } catch {} setBinaryImageUrl(""); }
    const start = Date.now();
    try {
      const headers = {};
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      if (pinnedConnectionId) headers["x-connection-id"] = pinnedConnectionId;
      if (useStreaming) headers["Accept"] = "text/event-stream";
      const body = { ...requestBody, model: modelFull };
      let res;
      if (useMultipart) {
        const form = new FormData();
        form.append("model", modelFull);
        form.append("prompt", input);
        const blob = await fetch(effectiveRefImage).then((r) => r.blob());
        form.append("image", blob, "image.png");
        if (effectiveMaskImage.startsWith("data:")) {
          const maskBlob = await fetch(effectiveMaskImage).then((r) => r.blob());
          form.append("mask", maskBlob, "mask.png");
        }
        res = await fetch(`/api/v1/images/edits`, { method: "POST", headers, body: form });
      } else {
        headers["Content-Type"] = "application/json";
        res = await fetch(`/api${apiPathWithQuery}`, {
          method: kindConfig.endpoint.method,
          headers,
          body: JSON.stringify(body),
        });
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error?.message || data?.error || `HTTP ${res.status}`);
        return;
      }
      const ctype = res.headers.get("content-type") || "";
      // Binary image response — convert to blob URL
      if (ctype.startsWith("image/")) {
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        setBinaryImageUrl(objUrl);
        setResult({ data: { binary: true, mime: ctype, size: blob.size }, latencyMs: Date.now() - start });
        return;
      }
      const isSse = ctype.includes("text/event-stream");
      if (isSse && res.body) {
        // Parse SSE: progress / partial_image / done / error
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let finalData = null;
        let streamErr = null;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let sep;
          while ((sep = buf.indexOf("\n\n")) !== -1) {
            const block = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            let evt = null, dataStr = "";
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) evt = line.slice(6).trim();
              else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
            }
            if (!evt) continue;
            try {
              const payload = dataStr ? JSON.parse(dataStr) : {};
              if (evt === "progress") setProgress(payload);
              else if (evt === "partial_image") setPartialImage(payload);
              else if (evt === "done") finalData = payload;
              else if (evt === "error") streamErr = payload?.message || "Stream error";
            } catch {}
          }
        }
        const latencyMs = Date.now() - start;
        if (streamErr) { setError(streamErr); return; }
        if (finalData) setResult({ data: finalData, latencyMs });
      } else {
        const data = await res.json();
        const latencyMs = Date.now() - start;
        setResult({ data, latencyMs });
      }
    } catch (e) {
      setError(e.message || "Network error");
    } finally {
      setRunning(false);
    }
  };

  // Mask large b64_json strings in JSON view to keep it readable
  const maskB64 = (obj) => {
    if (!obj || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(maskB64);
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = (k === "b64_json" && typeof v === "string" && v.length > 100)
        ? `<${v.length} chars base64>`
        : maskB64(v);
    }
    return out;
  };
  const resultJson = result ? JSON.stringify(maskB64(result.data), null, 2) : "";

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-4">Example</h2>
      <div className="flex flex-col gap-2.5">
        {/* Model selector — dropdown if presets exist, else manual input for media kinds */}
        {liveModelsLoading ? (
          <Row label="Model"><span className="text-sm text-text-muted">Loading models…</span></Row>
        ) : kindModels.length > 0 ? (
          <Row label="Model">
            <select
              value={selectedModel}
              onChange={(e) => {
                const nextId = e.target.value;
                const next = kindModels.find((m) => m.id === nextId);
                setSelectedModel(nextId);
                if (isXaiImage && !next?.capabilities?.includes("edit")) {
                  setMode("txt2img");
                  setRefSlots([""]);
                  setNextInputHint("");
                }
              }}
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
            >
              {kindModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name || m.id}</option>
              ))}
            </select>
          </Row>
        ) : allowManualModel ? (
          <Row label="Model">
            <input
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              placeholder="gpt-image-2"
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary font-mono"
            />
            <span className="text-xs text-text-muted">
              {liveModelsError
                ? `Could not list models: ${liveModelsError}. You can still type an id.`
                : "No models from /models. Enter an id, e.g. gpt-image-2"}
            </span>
          </Row>
        ) : null}

        {/* Endpoint */}
        <Row label="Endpoint">
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <span className="w-full min-w-0 flex-1 px-3 py-1.5 text-sm font-mono text-text-main bg-sidebar rounded-lg truncate">
              {endpoint}{apiPath}
            </span>
            {tunnelEndpoint && (
              <button
                onClick={() => setUseTunnel((v) => !v)}
                title={useTunnel ? "Using tunnel" : "Using local"}
                className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border shrink-0 transition-colors ${
                  useTunnel ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-text-muted hover:text-primary"
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">wifi_tethering</span>
                Tunnel
              </button>
            )}
          </div>
        </Row>

        {/* API Key */}
        <Row label="API Key">
          <span className="px-3 py-1.5 text-sm font-mono text-text-main bg-sidebar rounded-lg truncate block">
            {apiKey ? `${apiKey.slice(0, 8)}${"\u2022".repeat(Math.min(20, apiKey.length - 8))}` : <span className="text-text-muted italic">No key configured</span>}
          </span>
        </Row>

        {/* Connection picker - only show when 2+ connections (or any with email) */}
        {connections.length > 0 && (
          <Row label="Connection">
            <select
              value={pinnedConnectionId}
              onChange={(e) => setPinnedConnectionId(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
            >
              <option value="">Auto (by priority)</option>
              {connections.map((c) => {
                const plan = c.providerSpecificData?.chatgptPlanType;
                const label = c.email || c.name || c.id.slice(0, 8);
                return (
                  <option key={c.id} value={c.id}>
                    {label}{plan ? ` [${plan}]` : ""}
                  </option>
                );
              })}
            </select>
          </Row>
        )}

        {showMode && (
          <Row label="Mode">
            <div className="flex flex-col gap-1">
              <div role="radiogroup" className="flex gap-2">
                {[["txt2img", "Text to image"], ["img2img", "Image to image"]].map(([value, label]) => (
                  <label key={value} className="inline-flex items-center gap-1.5 text-sm">
                    <input
                      type="radio"
                      name="image-mode"
                      value={value}
                      checked={mode === value}
                      aria-checked={mode === value}
                      onChange={() => {
                        const next = value;
                        setMode(next);
                        if (!isXaiImage && next === "txt2img") {
                          setRefImage("");
                          setMaskImage("");
                        }
                        setInput((prev) => {
                          if (next === "img2img" && (prev === TXT2IMG_DEFAULT || prev === (safeExConfig.defaultInput || ""))) {
                            return IMG2IMG_DEFAULT;
                          }
                          if (next === "txt2img" && prev === IMG2IMG_DEFAULT) return TXT2IMG_DEFAULT;
                          return prev;
                        });
                      }}
                    />
                    {label}
                  </label>
                ))}
              </div>
              {isXaiImage && (
                <span className="text-xs text-text-muted">Same models. Image to image sends /v1/images/edits with up to 3 references.</span>
              )}
            </div>
          </Row>
        )}
        {xaiImg2img && (
          <Row label="Reference images">
            <div className="flex flex-col gap-3">
              {refSlots.map((slot, index) => {
                const preview = toImagePreviewSrc(slot);
                const isFileId = XAI_FILE_ID_RE.test(slot.trim());
                return (
                  <div key={index} className="flex flex-col gap-2 rounded-lg border border-border p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text-muted">Image {index + 1}</span>
                      {refSlots.length > 1 && (
                        <button
                          type="button"
                          className="text-xs text-text-muted hover:text-primary"
                          onClick={() => setRefSlots((prev) => prev.filter((_, i) => i !== index))}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      aria-invalid={img2imgMissingImage && index === 0}
                      onChange={(e) => handleFile(e.target.files?.[0], (value) => {
                        setRefSlots((prev) => prev.map((s, i) => (i === index ? value : s)));
                      })}
                    />
                    <input
                      value={slot.startsWith("data:") ? "" : slot}
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        setFileError("");
                        if (v.startsWith("data:")) {
                          if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(v) || v.length > 20 * 1024 * 1024 * 1.4) {
                            setFileError(DASH_IMAGE_ERR);
                            return;
                          }
                        }
                        setRefSlots((prev) => prev.map((s, i) => (i === index ? e.target.value : s)));
                      }}
                      placeholder="URL, data URI, or file_id"
                      className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
                    />
                    {isFileId && <span className="text-xs text-text-muted">file_id — no preview</span>}
                    {preview && (
                      <img
                        src={preview}
                        alt={`Image ${index + 1}`}
                        className="max-h-[240px] rounded-lg border border-border object-contain bg-sidebar"
                      />
                    )}
                  </div>
                );
              })}
              {fileError && <span className="text-xs text-red-500">{fileError}</span>}
              {img2imgMissingImage && (
                <span className="text-xs text-red-500">
                  Image to image needs a reference image. Add a PNG, JPEG, or WebP (max 20 MB), or paste a URL.
                </span>
              )}
              {xaiFilledSlots.length > 0 && (
                <span className="text-xs text-text-muted">{xaiFilledSlots.length} of 3 reference images</span>
              )}
              <button
                type="button"
                disabled={refSlots.length >= maxRefImages}
                onClick={() => setRefSlots((prev) => prev.length >= maxRefImages ? prev : [...prev, ""])}
                className="text-xs text-primary disabled:opacity-50 disabled:cursor-not-allowed text-left"
              >
                Add reference image
              </button>
            </div>
          </Row>
        )}
        {showMode && mode === "img2img" && !isXaiImage && (
          <Row label="Reference image">
            <div className="flex flex-col gap-2">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-invalid={img2imgMissingImage}
                onChange={(e) => handleFile(e.target.files?.[0], setRefImage)}
              />
              <input
                value={refImage.startsWith("data:") ? "" : refImage}
                onChange={(e) => { setFileError(""); setRefImage(e.target.value); }}
                placeholder="Or paste a URL / data URL"
                className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              />
              {fileError && <span className="text-xs text-red-500">{fileError}</span>}
              {refImagePreviewSrc && (
                <>
                  <img
                    src={refImagePreviewSrc}
                    alt={input.slice(0, 80) || "Reference image"}
                    className="max-h-[240px] rounded-lg border border-border object-contain bg-sidebar"
                  />
                  {refImage.startsWith("data:") && (
                    <span className="text-xs text-text-muted">
                      {(Math.max(0, Math.round((refImage.length * 3) / 4 / 1024)))} KB
                    </span>
                  )}
                </>
              )}
              {img2imgMissingImage && (
                <span className="text-xs text-red-500">Image to image needs a reference image.</span>
              )}
              {supportsMask && (
                <details>
                  <summary className="text-xs text-text-muted cursor-pointer">Advanced: mask (optional)</summary>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="mt-2"
                    onChange={(e) => handleFile(e.target.files?.[0], setMaskImage)}
                  />
                </details>
              )}
            </div>
          </Row>
        )}

        {/* Input */}
        <Row label={exConfig.inputLabel}>
          <div className="relative">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={xaiImg2img ? IMG2IMG_DEFAULT : exConfig.inputPlaceholder}
              className="w-full px-3 py-1.5 pr-7 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
            />
            {input && (
              <button
                type="button"
                onClick={() => setInput("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            )}
          </div>
          {xaiImg2img && xaiFilledSlots.length >= 2 && (
            <p className="text-xs text-text-muted">For multiple images, refer to them as &lt;IMAGE_0&gt;, &lt;IMAGE_1&gt;, &lt;IMAGE_2&gt;.</p>
          )}
        </Row>

        {/* Reference image (only for edit-capable image models) */}
        {supportsEdit && !showMode && (
          <Row label="Ref Image (URL)">
            <div className="flex flex-col gap-2">
              <div className="relative">
                <input
                  value={refImage}
                  onChange={(e) => setRefImage(e.target.value)}
                  placeholder={imageEditDefaults.image || "https://example.com/source.png"}
                  className="w-full px-3 py-1.5 pr-7 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
                />
                {refImage && (
                  <button
                    type="button"
                    onClick={() => setRefImage("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary transition-colors"
                  >
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                )}
              </div>
              {refImagePreviewSrc && (
                <img
                  src={refImagePreviewSrc}
                  alt="Reference"
                  className="max-h-40 rounded-lg border border-border object-contain bg-sidebar"
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                  onLoad={(e) => { e.currentTarget.style.display = "block"; }}
                loading="lazy"
                decoding="async"
                />
              )}
            </div>
          </Row>
        )}

        {supportsMask && !showMode && (
          <Row label="Mask (URL)">
            <div className="flex flex-col gap-2">
              <div className="relative">
                <input
                  value={maskImage}
                  onChange={(e) => setMaskImage(e.target.value)}
                  placeholder={imageEditDefaults.mask_image || "https://example.com/mask.png"}
                  className="w-full px-3 py-1.5 pr-7 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
                />
                {maskImage && (
                  <button
                    type="button"
                    onClick={() => setMaskImage("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary transition-colors"
                  >
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                )}
              </div>
              {maskImagePreviewSrc && (
                <img
                  src={maskImagePreviewSrc}
                  alt="Mask"
                  className="max-h-40 rounded-lg border border-border object-contain bg-sidebar"
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                  onLoad={(e) => { e.currentTarget.style.display = "block"; }}
                loading="lazy"
                decoding="async"
                />
              )}
            </div>
          </Row>
        )}

        {/* Extra fields — for kinds without model concept (webSearch/webFetch), show all; otherwise filter by model.params */}
        {extraFieldDefs
          .filter((f) => isXaiImage || customAlias || kindModels.length === 0 || (Array.isArray(selectedModelObj?.params) && selectedModelObj.params.includes(f.key)))
          .map((f) => (
          <Row key={f.key} label={f.label}>
            {f.type === "select" ? (
              <select
                value={extraValues[f.key] ?? ""}
                onChange={(e) => setExtraValues((s) => ({ ...s, [f.key]: e.target.value }))}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              >
                {(f.options || []).map((opt) => (
                  <option key={String(optionValue(opt))} value={optionValue(opt)}>{optionLabel(opt)}</option>
                ))}
              </select>
            ) : f.type === "text" ? (
              <input
                type="text"
                value={extraValues[f.key] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => setExtraValues((s) => ({ ...s, [f.key]: e.target.value }))}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              />
            ) : (
              <input
                type="number"
                value={extraValues[f.key] ?? ""}
                min={f.min}
                max={f.max}
                onChange={(e) => setExtraValues((s) => {
                  if (e.target.value === "") return { ...s, [f.key]: "" };
                  let n = Number(e.target.value);
                  if (Number.isNaN(n)) return s;
                  if (typeof f.min === "number") n = Math.max(f.min, n);
                  if (typeof f.max === "number") n = Math.min(f.max, n);
                  return { ...s, [f.key]: n };
                })}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              />
            )}
          </Row>
        ))}

        {/* Output Format toggle (image only) — last */}
        {kind === "image" && (
          <Row label="Output Format">
            <select
              value={imageOutputFormat}
              onChange={(e) => setImageOutputFormat(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
            >
              <option value="json">JSON (Base64)</option>
              <option value="binary">Binary File</option>
            </select>
          </Row>
        )}

        {/* Curl + Run */}
        <div className="mt-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-1.5">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Request</span>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <button
                onClick={() => copyCurl(curlSnippet)}
                className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">{copiedCurl ? "check" : "content_copy"}</span>
                {copiedCurl ? "Copied" : "Copy"}
              </button>
            <button
              onClick={handleRun}
              disabled={running || !input.trim() || !modelFull || missingDashboardKey || img2imgMissingImage}
              aria-busy={running}
              className="flex w-full sm:w-auto items-center justify-center gap-1.5 px-3 py-1 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <span className="material-symbols-outlined text-[14px]" style={running ? { animation: "spin 1s linear infinite" } : undefined}>
                  play_arrow
                </span>
                {running ? "Generating…" : "Run"}
              </button>
            </div>
          </div>
          <pre className="bg-sidebar rounded-lg px-3 py-2.5 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all">{curlSnippet}</pre>
          {kind === "image" && (
            <p className="mt-1 text-xs text-text-muted">
              {xaiImg2img
                ? "Image edits are billed for the input image(s) and the output. Run generates a real image and may incur charges."
                : "Run generates a real image and may incur charges. Check / Test never generate."}
            </p>
          )}
          {nextInputHint && <p className="mt-1 text-xs text-text-muted">{nextInputHint}</p>}
          {missingDashboardKey && (
            <p className="mt-1 text-xs text-amber-600">
              Add a Dashboard API key to run this example.{" "}
              <a href="/dashboard/api-keys" className="text-primary hover:underline">API keys</a>
            </p>
          )}
        </div>

        {/* Streaming progress */}
        {(running || progress) && useStreaming && (
          <div className="flex flex-col gap-2 px-3 py-2 rounded-lg bg-sidebar border border-border sm:flex-row sm:items-center sm:gap-3">
            <span className="material-symbols-outlined text-[16px] text-primary" style={running ? { animation: "spin 1s linear infinite" } : undefined}>
              {running ? "progress_activity" : "check_circle"}
            </span>
            <span className="text-xs text-text-muted">
              {progress?.stage || "starting"}
              {!running && progress?.bytesReceived ? ` · ${(progress.bytesReceived / 1024).toFixed(1)} KB` : ""}
            </span>
          </div>
        )}

        {/* Partial image preview (codex stream) */}
        {partialImage?.b64_json && !result && (
          <div>
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Partial preview</span>
            <img
              src={`data:image/png;base64,${partialImage.b64_json}`}
              alt="Partial"
              className="max-w-full rounded-lg border border-border mt-1.5 opacity-80"
            loading="lazy"
            decoding="async"
            />
          </div>
        )}

        {/* Error */}
        {error && <p className="text-xs text-red-500 break-words">{error}</p>}

        {/* Response */}
        <div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-1.5">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Response {result && <span className="font-normal normal-case">&#9889; {result.latencyMs}ms</span>}
            </span>
            {result && (
              <button
                onClick={() => copyRes(resultJson)}
                className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">{copiedRes ? "check" : "content_copy"}</span>
                {copiedRes ? "Copied" : "Copy"}
              </button>
            )}
          </div>
          <pre className="bg-sidebar rounded-lg px-3 py-2.5 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all opacity-70">
            {result ? resultJson : exConfig.defaultResponse}
          </pre>
          {kind === "image" && (binaryImageUrl || result?.data?.data?.[0]) && (
            <div className="mt-2 flex flex-col gap-3">
              {(binaryImageUrl
                ? [{ src: binaryImageUrl, download: binaryImageUrl, bytes: true }]
                : (result?.data?.data || []).map((item) => ({
                    src: item.b64_json ? `data:image/png;base64,${item.b64_json}` : item.url,
                    download: item.b64_json ? `data:image/png;base64,${item.b64_json}` : item.url,
                    bytes: !!item.b64_json,
                    raw: item,
                  }))
              ).map((item, idx) => (
                <div key={idx} className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center justify-end gap-3">
                    <a
                      href={item.download || ""}
                      download="image.png"
                      className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors"
                    >
                      <span className="material-symbols-outlined text-[14px]">download</span>
                      Download
                    </a>
                    {isXaiImage && (
                      <>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary"
                          onClick={() => applyResultAsReference(item, { replace: true })}
                        >
                          Use as next input
                        </button>
                        {xaiFilledSlots.length > 0 && xaiFilledSlots.length < 3 && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary"
                            onClick={() => applyResultAsReference(item, { replace: false })}
                          >
                            Add as another reference
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  {item.src && (
                    <img
                      src={item.src}
                      alt={`Generated ${idx + 1}`}
                      className="max-w-full rounded-lg border border-border"
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
