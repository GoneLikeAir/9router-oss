const XAI_ASPECT_RATIOS = [
  "1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2",
  "9:19.5", "19.5:9", "9:20", "20:9", "1:2", "2:1", "auto",
];

export function xaiExampleFlags({
  providerId,
  kind,
  customAlias,
  imageCapabilities,
  selectedModelObj,
  mode,
  effectiveRefImage,
} = {}) {
  const isXaiImage = providerId === "xai" && kind === "image";
  const showMode = kind === "image" && (
    !!customAlias
      ? imageCapabilities?.edit !== false
      : isXaiImage && !!selectedModelObj?.capabilities?.includes("edit")
  );
  const useMultipart = !!customAlias && showMode && mode === "img2img"
    && typeof effectiveRefImage === "string" && effectiveRefImage.startsWith("data:");
  const supportsMask = !!customAlias
    ? mode === "img2img"
    : !!selectedModelObj?.capabilities?.includes("mask");
  const maxRefImages = isXaiImage ? 3 : 1;
  return { isXaiImage, showMode, useMultipart, supportsMask, maxRefImages };
}

const RATIO_VALUES = XAI_ASPECT_RATIOS.filter((r) => r !== "auto");

export function getXaiImageExtraFields({ mode } = {}) {
  return [
    { key: "n", label: "n", type: "number", default: 1, min: 1, max: 4 },
    {
      key: "aspect_ratio",
      label: "Aspect ratio",
      type: "select",
      default: "auto",
      options: [
        { value: "auto", label: mode === "img2img" ? "Auto — match first image" : "Auto" },
        ...RATIO_VALUES.map((value) => ({ value, label: value })),
      ],
    },
    {
      key: "resolution",
      label: "Resolution",
      type: "select",
      default: "",
      options: [
        { value: "", label: "(default)" },
        { value: "1k", label: "1k" },
        { value: "2k", label: "2k" },
      ],
    },
  ];
}

export function getXaiQualityField() {
  return {
    key: "quality",
    label: "Quality",
    type: "select",
    default: "medium",
    options: [
      { value: "medium", label: "medium" },
      { value: "low", label: "low" },
    ],
  };
}

export const XAI_FILE_ID_RE = /^file_[A-Za-z0-9-]+$/;

export function extraBodyFromXaiFields(extraValues, extraFieldDefs) {
  const allowed = new Set((extraFieldDefs || []).map((f) => f.key));
  const out = {};
  for (const [k, v] of Object.entries(extraValues || {})) {
    if (!allowed.has(k)) continue;
    if (v === "" || v === null || v === undefined) continue;
    if (typeof v === "number" && Number.isNaN(v)) continue;
    out[k] = v;
  }
  return out;
}
