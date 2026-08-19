"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Button, Badge, Input, Modal, Select, ConfirmModal } from "@/shared/components";

export default function EditCompatibleNodeModal({ isOpen, node, onSave, onClose, isAnthropic }) {
  const [formData, setFormData] = useState({
    name: "",
    prefix: "",
    apiType: "chat",
    baseUrl: "https://api.openai.com/v1",
  });
  const [saving, setSaving] = useState(false);
  const [checkKey, setCheckKey] = useState("");
  const [checkModelId, setCheckModelId] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [validationError, setValidationError] = useState("");
  const [pendingType, setPendingType] = useState(null);

  useEffect(() => {
    if (node) {
      setFormData({
        name: node.name || "",
        prefix: node.prefix || "",
        apiType: node.apiType || "chat",
        baseUrl: node.baseUrl || (isAnthropic ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"),
        imageCapabilities: node.imageCapabilities || { generation: true, edit: true },
      });
    }
  }, [node, isAnthropic]);

  const apiTypeOptions = [
    { value: "chat", label: "Chat Completions" },
    { value: "responses", label: "Responses API" },
    { value: "images", label: "Images API" },
  ];

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: formData.name,
        prefix: formData.prefix,
        baseUrl: formData.baseUrl,
      };
      if (!isAnthropic) {
        payload.apiType = formData.apiType;
        if (formData.apiType === "images") payload.imageCapabilities = formData.imageCapabilities;
      }
      await onSave(payload);
    } finally {
      setSaving(false);
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
          type: isAnthropic ? "anthropic-compatible" : "openai-compatible",
          modelId: checkModelId.trim() || undefined,
          apiType: formData.apiType,
        }),
      });
      const data = await res.json();
      setValidationResult(data.valid ? "success" : "failed");
      setValidationError(data.valid ? "" : String(data.error || "Invalid"));
    } catch {
      setValidationResult("failed");
      setValidationError("Network error");
    } finally {
      setValidating(false);
    }
  };

  if (!node) return null;

  return (
    <>
    <Modal isOpen={isOpen} title={`Edit ${isAnthropic ? "Anthropic" : "OpenAI"} Compatible`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={`${isAnthropic ? "Anthropic" : "OpenAI"} Compatible (Prod)`}
          hint="Required. A friendly label for this node."
        />
        <Input
          label="Prefix"
          value={formData.prefix}
          onChange={(e) => setFormData({ ...formData, prefix: e.target.value })}
          placeholder={isAnthropic ? "ac-prod" : "oc-prod"}
          hint="Required. Used as the provider prefix for model IDs."
        />
        {!isAnthropic && (
          <Select
            label="API Type"
            options={apiTypeOptions}
            value={formData.apiType}
            onChange={(e) => {
              const next = e.target.value;
              const prev = formData.apiType;
              if ((prev === "images") !== (next === "images")) {
                setPendingType(next);
                return;
              }
              setFormData({ ...formData, apiType: next });
            }}
          />
        )}
        <Input
          label="Base URL"
          value={formData.baseUrl}
          onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
          placeholder={isAnthropic ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"}
          hint={formData.apiType === "images"
            ? "Stop at /v1. 9router appends /images/generations and /images/edits."
            : `Use the base URL (ending in /v1) for your ${isAnthropic ? "Anthropic" : "OpenAI"}-compatible API.`}
        />
        {formData.apiType === "images" && (
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.imageCapabilities?.generation !== false}
                onChange={(e) => setFormData({
                  ...formData,
                  imageCapabilities: { ...(formData.imageCapabilities || {}), generation: e.target.checked },
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
                  imageCapabilities: { ...(formData.imageCapabilities || {}), edit: e.target.checked },
                })}
              />
              Image to image (edits)
            </label>
            <p className="text-xs text-text-muted">Check calls GET /models only. It does not generate an image and will not incur image charges.</p>
          </div>
        )}
        <div className="flex gap-2">
          <Input
            label="API Key (for Check)"
            type="password"
            value={checkKey}
            onChange={(e) => setCheckKey(e.target.value)}
            className="flex-1"
          />
          <div className="pt-6">
            <Button onClick={handleValidate} disabled={!checkKey || validating || !formData.baseUrl.trim()} variant="secondary">
              {validating ? "Checking..." : "Check"}
            </Button>
          </div>
        </div>
        <Input
          label="Model ID (optional)"
          value={checkModelId}
          onChange={(e) => setCheckModelId(e.target.value)}
          placeholder="e.g. my-model-id"
          hint={formData.apiType === "images"
            ? "Optional note if /models is missing. Never used for chat or generations."
            : "If provider lacks /models endpoint, enter a model ID to validate via chat/completions instead."}
        />
        {validationResult && (
          <div className="flex flex-col gap-1">
            <Badge variant={validationResult === "success" ? "success" : "error"}>
              {validationResult === "success" ? "Valid" : "Invalid"}
            </Badge>
            {validationResult !== "success" && validationError && (
              <span className="text-xs text-red-500">{validationError}</span>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim() || saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
      <ConfirmModal
        isOpen={!!pendingType}
        title={pendingType === "images" ? "Switch this node to Images API?" : "Switch this node to Chat?"}
        confirmText={pendingType === "images" ? "Switch to Images" : "Switch to Chat"}
        message={pendingType === "images"
          ? `After this, ${formData.prefix || "this prefix"}/* cannot be used for chat. Use /v1/images/generations or /v1/images/edits. Existing connections and the API key are kept.`
          : "This node will leave Text to Image. Image playground and /v1/models/image will stop listing it. Connections are kept."}
        onClose={() => setPendingType(null)}
        onConfirm={() => {
          if (pendingType) setFormData({ ...formData, apiType: pendingType });
          setPendingType(null);
        }}
      />
    </>
  );
}

EditCompatibleNodeModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  node: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    prefix: PropTypes.string,
    apiType: PropTypes.string,
    baseUrl: PropTypes.string,
  }),
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  isAnthropic: PropTypes.bool,
};
