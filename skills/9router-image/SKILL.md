---
name: 9router-image
description: Generate or edit images via 9Router /v1/images/generations and /v1/images/edits using OpenAI / Gemini Imagen / DALL-E / FLUX / MiniMax / SDWebUI / ComfyUI / Codex / xAI Grok Imagine models. Use when the user wants to create, generate, draw, render, edit, image-to-image, img2img, or modify an image.
---

# 9Router — Image Generation

Requires `NINEROUTER_URL` (and `NINEROUTER_KEY` if auth enabled). See https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router/SKILL.md for setup.

xAI Imagine (`xai/grok-imagine-image`, `xai/grok-imagine-image-quality`, `xai/grok-imagine-image-2.0`; legacy `xai/grok-2-image-1212` is deprecated upstream) works with **either** a Grok CLI (Grok Build) login **or** an xAI API key. Prefer `xai/grok-imagine-image`. Do not use a `gcli/` prefix for images. Grok CLI device login and xAI OAuth on the xAI provider page are different credentials.

## Discover

```bash
curl $NINEROUTER_URL/v1/models/image | jq '.data[].id'
# Per-model params/options (size enum, quality enum, capabilities like edit)
curl "$NINEROUTER_URL/v1/models/info?id=openai/dall-e-3"
```

## Endpoint

`POST $NINEROUTER_URL/v1/images/generations`

| Field | Required | Notes |
|---|---|---|
| `model` | yes | from `/v1/models/image` |
| `prompt` | yes | image description |
| `n` | no | count (provider-dependent) |
| `size` | no | `1024x1024`, `1792x1024`, ... |
| `quality` | no | `standard` / `hd` (OpenAI) |
| `response_format` | no | `url` (default) or `b64_json` |

Add query `?response_format=binary` to receive raw image bytes (handy for saving file).

### Image to image

`POST $NINEROUTER_URL/v1/images/edits`

JSON (`image` = URL, data URL, or raw base64) or `multipart/form-data` (`image=@file.png`). Custom OpenAI-compatible Images nodes (e.g. `imgnode/gpt-image-2`) also accept `image` / `images` on `/v1/images/generations` and rewrite to upstream `/images/edits`. Combo names such as `gpt-image-2` only expand on `/v1/images/generations`; `/v1/images/edits` needs a prefixed id (`imgnode/gpt-image-2`). See [`docs/gpt-image-usage.md`](../../docs/gpt-image-usage.md).

xAI Grok Imagine (`xai/grok-imagine-image*`): Against 9router you may send JSON or multipart; the gateway always calls xAI as JSON. Do not point the OpenAI SDK `images.edit()` at api.x.ai — that path is multipart and xAI rejects it. Do not use a `gcli/` model prefix. Up to 3 refs; multi-image uses `images` and `<IMAGE_0>` in the prompt.

```bash
curl -X POST "$NINEROUTER_URL/v1/images/edits" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"xai/grok-imagine-image","prompt":"Render this as a pencil sketch","image":{"url":"https://example.com/photo.png","type":"image_url"}}'
```

```bash
curl -X POST "$NINEROUTER_URL/v1/images/edits" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"xai/grok-imagine-image","prompt":"Combine <IMAGE_0> and <IMAGE_1>","images":[{"url":"https://example.com/a.png"},{"url":"https://example.com/b.png"}]}'
```

```bash
curl -X POST "$NINEROUTER_URL/v1/images/edits" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"imgnode/gpt-image-2","prompt":"make the apple green","image":"https://example.com/apple.png"}'
```

## Examples

Save to file (binary):

```bash
curl -X POST "$NINEROUTER_URL/v1/images/generations?response_format=binary" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini/gemini-3-pro-image-preview","prompt":"watercolor mountains at sunrise","size":"1024x1024"}' \
  --output out.png
```

JS (URL response):

```js
const r = await fetch(`${process.env.NINEROUTER_URL}/v1/images/generations`, {
  method: "POST",
  headers: { "Authorization": `Bearer ${process.env.NINEROUTER_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ model: "gemini/gemini-3-pro-image-preview", prompt: "neon city", size: "1024x1024" }),
});
const { data } = await r.json();
console.log(data[0].url || data[0].b64_json.slice(0, 40));
```

## Response shape

JSON (default `response_format=url`):
```json
{ "created": 1735000000, "data": [{ "url": "https://..." }] }
```

`response_format=b64_json`:
```json
{ "created": 1735000000, "data": [{ "b64_json": "iVBORw0KGgo..." }] }
```

Query `?response_format=binary` returns raw image bytes (Content-Type `image/png` or `image/jpeg`).

## Provider quirks

Common fields above work everywhere. These add/override:

| Provider | Extra/changed fields | Notes |
|---|---|---|
| `openai`, `minimax`, `openrouter`, `recraft` | `quality`, `style`, `response_format` | Standard OpenAI shape |
| `gemini` (nano-banana) | — | Only `prompt`; ignores `size`/`n` |
| `codex` (gpt-5.4-image) | `image`, `images[]`, `image_detail`, `output_format`, `background` | SSE stream; **ChatGPT Plus/Pro required** |
| `huggingface` | — | Only `prompt`; returns single image |
| `nanobanana` | `image`, `images[]` (edit mode) | `size` → aspect ratio; async polling |
| `fal-ai` | `image` (img2img) | `n` → `num_images`; `size` → ratio; async |
| `stability-ai` | `style` (preset), `output_format` | `size` → `aspect_ratio` |
| `black-forest-labs` (FLUX) | `image` (ref) | `size` → exact `width`/`height`; async |
| `runwayml` | `image` (ref) | `size` → ratio; async; video models exist |
| `sdwebui`, `comfyui` | — | Localhost noAuth (`:7860` / `:8188`) |
| `xai` (Grok Imagine) | `image` / `images` (**max 3**), `aspect_ratio`, `resolution`, `quality` on 2.0 | Official API cap is 3 for all current image models. JSON to `/v1/images/edits`; no mask; `size` maps or is omitted. Video is separate: `reference_images` **max 7**, one start `image` for i2v; see `docs/grok-media-api.md` |
| OpenAI-compat images (`imgnode/…`, optional combo name) | `image` / `images[]` | Gateway does not cap count (20 MB/file). Upstream hosts have their own limits. Official OpenAI docs say 16. |
