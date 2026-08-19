export const XAI_IMAGINE_MAX_REF_IMAGES = 3;
/** 9router local cap for File / data URI / raw base64. Public URLs are not downloaded. */
export const XAI_IMAGINE_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const XAI_IMAGINE_ASPECT_RATIOS = [
  "1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2",
  "9:19.5", "19.5:9", "9:20", "20:9", "1:2", "2:1", "auto",
];
export const XAI_IMAGINE_RESOLUTIONS = ["1k", "2k"];
export const XAI_IMAGINE_QUALITY_MODELS = new Set(["grok-imagine-image-2.0"]);
export const XAI_IMAGINE_EDIT_FIELDS = [
  "model", "prompt", "n", "aspect_ratio", "resolution",
  "response_format", "quality", "storage_options", "user", "image", "images",
];
export const XAI_IMAGINE_GEN_FIELDS = [
  "model", "prompt", "n", "aspect_ratio", "resolution",
  "response_format", "quality", "storage_options", "user",
];
export const XAI_FILE_ID_RE = /^file_[A-Za-z0-9-]+$/;

const SIZE_TO_ASPECT = {
  "1024x1024": "1:1",
  "1024x1792": "9:16",
  "1792x1024": "16:9",
  "1024x1536": "2:3",
  "1536x1024": "3:2",
};

/** Map OpenAI `size` to an official Imagine ratio. Unknown / "auto" → undefined (omit). */
export function sizeToXaiAspectRatio(size) {
  return SIZE_TO_ASPECT[size];
}
