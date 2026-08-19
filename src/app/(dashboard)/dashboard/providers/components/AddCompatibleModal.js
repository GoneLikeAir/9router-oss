"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Badge, Button, Input, Modal, Select } from "@/shared/components";

const VARIANT_CONFIG = {
  openai: {
    title: "Add OpenAI Compatible",
    type: "openai-compatible",
    defaultBaseUrl: "https://api.openai.com/v1",
    namePlaceholder: "OpenAI Compatible (Prod)",
    prefixPlaceholder: "oc-prod",
    baseUrlHint: "Use the base URL (ending in /v1) for your OpenAI-compatible API.",
    modelIdPlaceholder: "e.g. gpt-4, claude-3-opus",
    errorLabel: "OpenAI Compatible",
    hasApiType: true,
  },
  anthropic: {
    title: "Add Anthropic Compatible",
    type: "anthropic-compatible",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    namePlaceholder: "Anthropic Compatible (Prod)",
    prefixPlaceholder: "ac-prod",
    baseUrlHint: "Use the base URL (ending in /v1) for your Anthropic-compatible API. The system will append /messages.",
    modelIdPlaceholder: "e.g. claude-3-opus",
    errorLabel: "Anthropic Compatible",
    hasApiType: false,
  },
};

const API_TYPE_OPTIONS = [
  { value: "chat", label: "Chat Completions" },
  { value: "responses", label: "Responses API" },
  { value: "images", label: "Images API" },
];

const CHAT_DEFAULT_URL = "https://api.openai.com/v1";

function AddCompatibleModal({ variant, isOpen, onClose, onCreated, initialApiType }) {
  const config = VARIANT_CONFIG[variant];
  const initialFormData = () => {
    const apiType = config.hasApiType ? (initialApiType || "chat") : undefined;
    return {
      name: "",
      prefix: "",
      ...(config.hasApiType ? { apiType } : {}),
      baseUrl: apiType === "images" ? "" : config.defaultBaseUrl,
      imageCapabilities: { generation: true, edit: true },
    };
  };

  const [formData, setFormData] = useState(initialFormData);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [checkKey, setCheckKey] = useState("");
  const [checkModelId, setCheckModelId] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setFormData(initialFormData());
    setValidationResult(null);
    setCheckKey("");
    setCheckModelId("");
    setSubmitError("");
  }, [isOpen, initialApiType, variant]);

  const isImages = config.hasApiType && formData.apiType === "images";

  const handleApiTypeChange = (nextType) => {
    setFormData((prev) => {
      const next = { ...prev, apiType: nextType };
      if (nextType === "images" && (!prev.baseUrl || prev.baseUrl === CHAT_DEFAULT_URL)) {
        next.baseUrl = "";
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await fetch("/api/provider-nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          prefix: formData.prefix,
          ...(config.hasApiType ? { apiType: formData.apiType } : {}),
          baseUrl: formData.baseUrl,
          type: config.type,
          ...(isImages ? { imageCapabilities: formData.imageCapabilities } : {}),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        onCreated(data.node);
        setFormData(initialFormData());
        setCheckKey("");
        setValidationResult(null);
      } else {
        setSubmitError(data.error || `Failed to create ${config.errorLabel} node`);
      }
    } catch (error) {
      setSubmitError(error.message || "Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch("/api/provider-nodes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: formData.baseUrl,
          apiKey: checkKey,
          type: config.type,
          modelId: checkModelId.trim() || undefined,
          ...(config.hasApiType ? { apiType: formData.apiType } : {}),
        }),
      });
      const data = await res.json();
      setValidationResult(data);
    } catch {
      setValidationResult({ valid: false, error: "Network error" });
    } finally {
      setValidating(false);
    }
  };

  const renderValidationResult = () => {
    if (!validationResult) return null;
    const { valid, error, method } = validationResult;
    if (valid) {
      return (
        <>
          <Badge variant="success">Valid</Badge>
          {method === "chat" && (
            <span className="text-sm text-text-muted">(via inference test)</span>
          )}
        </>
      );
    }
    return (
      <div className="flex flex-col gap-1">
        <Badge variant="error">Invalid</Badge>
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>
    );
  };

  return (
    <Modal isOpen={isOpen} title={config.title} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={config.namePlaceholder}
          hint="Required. A friendly label for this node."
        />
        <Input
          label="Prefix"
          value={formData.prefix}
          onChange={(e) => setFormData({ ...formData, prefix: e.target.value })}
          placeholder={config.prefixPlaceholder}
          hint={isImages ? "Model ids look like {prefix}/gpt-image-2." : "Required. Used as the provider prefix for model IDs."}
        />
        {config.hasApiType && (
          <Select
            label="API Type"
            options={API_TYPE_OPTIONS}
            value={formData.apiType}
            onChange={(e) => handleApiTypeChange(e.target.value)}
            hint={isImages ? "Use this for OpenAI-compatible image hosts (generations + edits). This prefix cannot be used for chat." : undefined}
          />
        )}
        <Input
          label="Base URL"
          value={formData.baseUrl}
          onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
          placeholder={isImages ? "https://api.example.com/v1" : config.defaultBaseUrl}
          hint={isImages ? "Stop at /v1. 9router appends /images/generations and /images/edits." : config.baseUrlHint}
        />
        {isImages && (
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.imageCapabilities?.generation !== false}
                onChange={(e) => setFormData({
                  ...formData,
                  imageCapabilities: { ...formData.imageCapabilities, generation: e.target.checked },
                })}
              />
              Text to image
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.imageCapabilities?.edit !== false}
                onChange={(e) => setFormData({
                  ...formData,
                  imageCapabilities: { ...formData.imageCapabilities, edit: e.target.checked },
                })}
              />
              Image to image (edits)
            </label>
          </div>
        )}
        <Input
          label="API Key (for Check)"
          type="password"
          value={checkKey}
          onChange={(e) => setCheckKey(e.target.value)}
        />
        <Input
          label="Model ID (optional)"
          value={checkModelId}
          onChange={(e) => setCheckModelId(e.target.value)}
          placeholder={config.modelIdPlaceholder}
          hint={isImages
            ? "Optional note if /models is missing. Never used for chat or generations."
            : "If provider lacks /models endpoint, enter a model ID to validate via chat/completions instead."}
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            onClick={handleValidate}
            disabled={!checkKey || validating || !formData.baseUrl.trim()}
            variant="secondary"
            className="w-full sm:w-auto"
          >
            {validating ? "Checking..." : "Check"}
          </Button>
          {renderValidationResult()}
        </div>
        {isImages && (
          <p className="text-xs text-text-muted">
            Check calls GET {"{base}"}/models only. It does not generate an image and will not incur image charges.
          </p>
        )}
        {validationResult && !validationResult.valid && isImages && (
          <p className="text-xs text-text-muted">
            Check did not pass. You can still create; add a connection proxy if the host is not reachable directly.
          </p>
        )}
        {submitError && <p className="text-sm text-red-500">{submitError}</p>}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            onClick={handleSubmit}
            fullWidth
            disabled={
              !formData.name.trim() ||
              !formData.prefix.trim() ||
              !formData.baseUrl.trim() ||
              submitting
            }
          >
            {submitting ? "Creating..." : "Create"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

AddCompatibleModal.propTypes = {
  variant: PropTypes.oneOf(["openai", "anthropic"]).isRequired,
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onCreated: PropTypes.func.isRequired,
  initialApiType: PropTypes.oneOf(["chat", "responses", "images"]),
};

export default AddCompatibleModal;
