# Grok 图片 / 视频 API 使用指南

> 相对官方 decolua/9router 的改动总览见 [`vs-upstream.md`](./vs-upstream.md)。图像速查见 [`grok-image-usage.md`](./grok-image-usage.md)。

用 9router 调用 xAI Grok Imagine 的图片和视频能力。业务只打 9router，不要直连 `api.x.ai`，也不要把 Grok / xAI token 下发给客户端。

| | 图片 | 视频 |
|---|---|---|
| 同步性 | 一次 POST 出图 | 先拿 `request_id`，再轮询 |
| 文生 | `POST /v1/images/generations` | `POST /v1/videos/generations` |
| 参考输入 | `POST /v1/images/edits`（**最多 3 张**） | 同 generations：`image` 锁 1 张首帧；`reference_images` **最多 7 张** |
| 改已有内容 | `POST /v1/images/edits` | `POST /v1/videos/edits` |
| 续写 | 无 | `POST /v1/videos/extensions` |
| 查询任务 | 无 | `GET /v1/videos/{request_id}` |
| 模型前缀 | **`xai/`** | **`xai/`** |
| 聊天模型 | 不能用来生图 | 不能用来生视频 |

本地 / 本机网关默认 `http://127.0.0.1:20128`。下文 `$BASE` 换成你的地址。

---

## 1. 开始之前

### 1.1 鉴权（打 9router）

生产若开了 `REQUIRE_API_KEY`，每个请求都要带 **9router 自己的 Key**，不是 xAI 的 `sk-`。

```http
Authorization: Bearer $NINEROUTER_KEY
Content-Type: application/json
```

拿 Key：Dashboard → **Keys**（例如 `Default Key`）。本机 sqlite：

```bash
NINEROUTER_KEY=$(sqlite3 "${DATA_DIR:-$HOME/.9router}/db/data.sqlite" \
  "SELECT key FROM apiKeys WHERE name='Default Key' LIMIT 1;")
```

下文用 `$BASE` 表示网关根地址，例如 `http://127.0.0.1:20128`。

### 1.2 上游凭证（管理员配一次）

下游调用不需要 xAI Key。网关用已登录的账号去打 Imagine。两种任选其一：

1. **推荐**：Dashboard → Providers → **Grok CLI (Grok Build)**，device code 登录，连接保持 Active。
2. 备选：Providers → **xAI (Grok)** 加 console.x.ai 的 API Key，或点 **xAI OAuth**（和 Grok CLI 登录不是同一件事）。

同时有 xAI Key 和 Grok CLI 时：先走 xAI Key，失败（401 / 403 / 402 / 429）再落到 Grok CLI。

不要：

- 再登一次「xAI」才以为能出图/出视频。Grok CLI 登过就可以。
- 指望 **Grok Web (Subscription)** cookie。那条路打不通 Imagine。
- 在 Grok CLI 页找图像/视频模型。那边只有聊天。
- 模型写成 `gcli/grok-imagine-image` 或 `gcli/grok-imagine-video`。媒体必须用 **`xai/`**。

Free / X Basic 通常不含 Imagine。页面会标 **Imagine not included**，调用会 403。

### 1.3 页面试玩

| 能力 | 路径 |
|---|---|
| 图片 | Dashboard → Media Providers → Text to Image → **xAI (Grok)** |
| 视频 | Dashboard → Media Providers → Video → **xAI (Grok)** |

只有 Grok CLI、没有 xAI Key 时，卡片应是 **Ready · Uses Grok Build login**，不是 `1 Connected`。不要在媒体页 Disable / Delete 这条 Grok CLI 登录（会误关聊天）。

---

## 2. 模型

调用时必须带 `xai/` 前缀。

### 2.1 图片

| 模型 ID | 用途 |
|---|---|
| `xai/grok-imagine-image` | **推荐默认**。文生图 + 图生图。改图最多 **3** 张参考 |
| `xai/grok-imagine-image-quality` | 画质档。文生图 + 图生图。改图同样最多 3 张 |
| `xai/grok-imagine-image-2.0` | Imagine Image 2.0。可额外传 `quality`。API 改图仍是最多 3 张（grok.com 产品页有时写 5，以 API 为准） |
| `xai/grok-2-image-1212` | **已弃用**。上游 404，不要用 |

列出网关已挂出的图像模型：

```bash
curl -sS "$BASE/v1/models/image" \
  -H "Authorization: Bearer $NINEROUTER_KEY" | jq '.data[].id'
```

看单个模型参数（含 `edit`）：

```bash
curl -sS "$BASE/v1/models/info?id=xai/grok-imagine-image" \
  -H "Authorization: Bearer $NINEROUTER_KEY"
```

支持 edit 的模型会带 `editEndpoint: "/v1/images/edits"`。

### 2.2 视频

| 模型 ID | 用途 |
|---|---|
| `xai/grok-imagine-video` | 默认视频模型。文生、图生（1 张首帧）、参考图生（最多 **7** 张）、改/续 |
| `xai/grok-imagine-video-1.5` | 官方新模型。9router **原样透传**。文生/图生可到 1080p；参考图生最高 720p、最多 7 张图 + 最多 3 个预设音色 |

网关没有 `/v1/models/video`。`GET /v1/models` 只列聊天模型。视频请直接用上表 ID。

聊天模型（`gcli/grok-4.6`、`xai/grok-4` 等）不能用来生图或生视频。

---

## 3. 图片 API

图片是**同步**的：POST 成功即返回 URL 或 Base64。

### 3.1 文生图

`POST /v1/images/generations`

```bash
curl -sS -X POST "$BASE/v1/images/generations" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "xai/grok-imagine-image",
    "prompt": "一只红色的苹果，静物摄影，白底",
    "n": 1,
    "aspect_ratio": "1:1",
    "resolution": "1k"
  }'
```

成功大致是：

```json
{
  "created": 1735000000,
  "data": [{ "url": "https://..." }]
}
```

`response_format=b64_json` 时用 `data[0].b64_json`。上游返回的 URL **会过期**，要留文件请马上下载，或用下面的 binary。

直接存文件：

```bash
curl -sS -X POST "$BASE/v1/images/generations?response_format=binary" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"xai/grok-imagine-image","prompt":"一只红色的苹果，静物摄影，白底"}' \
  --output apple.png
```

### 3.2 图生图 / 改图

`POST /v1/images/edits`

三个现役模型都支持。不要用 `grok-2-image-1212`。

对 9router 可以发 JSON 或 `multipart/form-data`；网关转给 xAI **一律 JSON**。不要把 OpenAI SDK 的 `images.edit()` 直接打到 `api.x.ai`（那边拒 multipart）。打 9router 的 `/v1/images/edits` 可以。

**没有 mask。** 传 `mask` / `mask_image` 会 400。

单图：

```bash
curl -sS -X POST "$BASE/v1/images/edits" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "xai/grok-imagine-image",
    "prompt": "改成铅笔素描",
    "image": {
      "url": "https://docs.x.ai/assets/api-examples/images/style-realistic.png",
      "type": "image_url"
    },
    "aspect_ratio": "auto"
  }'
```

多图（最多 3 张，prompt 里用 `<IMAGE_0>` `<IMAGE_1>` `<IMAGE_2>` 指代）：

```bash
curl -sS -X POST "$BASE/v1/images/edits" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "xai/grok-imagine-image",
    "prompt": "把 <IMAGE_0> 的主体放进 <IMAGE_1> 的场景",
    "images": [
      {"url": "https://example.com/person.png"},
      {"url": "https://example.com/scene.png"}
    ]
  }'
```

`image` 和 `images` **不能同时传**。

参考图写法（任选一种）：

| 形态 | 例子 |
|---|---|
| 对象 + 公网 URL | `{"url":"https://…"}` 或 `{"url":"https://…","type":"image_url"}` |
| 对象 + data URI | `{"url":"data:image/png;base64,…"}` |
| 对象 + Files id | `{"file_id":"file_…"}` |
| 字符串 URL | `"https://…"` |
| 字符串 data URI | `"data:image/jpeg;base64,…"` |
| 字符串 file_id | `"file_7de029f4-eb66-42ee-87f8-b2a9d9e7466a"` |
| 顶层别名 | `"image_url": "https://…"`（仅当没传 `image` / `images`） |
| 裸 Base64 | 网关会包成 `data:image/png;base64,…` |
| multipart 文件 | `image=@ref.png`（网关读入后再转 JSON） |

限制：

- **最多 3 张**（官方 Imagine Image Editing；9router 超限会 400 `Grok Imagine accepts at most 3 reference images.`）。三个现役图像模型同一上限。
- 格式：JPEG / PNG / WebP。
- 网关读进内存的 File / data URI / 裸 Base64 **不超过 20 MB**。公网 URL 不下载，网关不做体积检查。
- 9router **没有** `/v1/files` 上传。`file_id` 只透传给上游；你得自己在 xAI Files 拿到 id。
- 编辑按 **输入图 + 输出图** 两边计费。不要盲目重试创建请求。

multipart 示例：

```bash
curl -sS -X POST "$BASE/v1/images/edits" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -F "model=xai/grok-imagine-image" \
  -F "prompt=改成水彩风格" \
  -F "image=@./ref.png" \
  -F "aspect_ratio=auto"
```

### 3.3 图片请求字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `model` | 是 | 如 `xai/grok-imagine-image` |
| `prompt` | 是 | 画面描述或改图指令 |
| `n` | 否 | 张数，默认 1 |
| `aspect_ratio` | 否 | 见下表。省略时：文生图由模型决定；改图默认跟第一张参考图 |
| `resolution` | 否 | `1k` 或 `2k` |
| `response_format` | 否 | `url`（默认）或 `b64_json` |
| `quality` | 否 | 仅 `grok-imagine-image-2.0`：`low` / `medium`。其他模型或不合法值会被丢掉 |
| `size` | 否 | OpenAI 习惯尺寸。仅当能映射到官方比例时转成 `aspect_ratio`；`auto` / 未知尺寸不传 |
| `storage_options` | 否 | 上游落盘。`filename` 必填；可选 `public_url`、`expires_after`（秒，≤ 2592000） |
| `user` | 否 | 滥用追踪，原样转发 |
| `image` / `images` | 改图必填 | 见 §3.2 |

`aspect_ratio` 取值：

`1:1` · `3:4` · `4:3` · `9:16` · `16:9` · `2:3` · `3:2` · `9:19.5` · `19.5:9` · `9:20` · `20:9` · `1:2` · `2:1` · `auto`

`size` → `aspect_ratio` 映射：

| `size` | 比例 |
|---|---|
| `1024x1024` | `1:1` |
| `1024x1792` | `9:16` |
| `1792x1024` | `16:9` |
| `1024x1536` | `2:3` |
| `1536x1024` | `3:2` |

Query `?response_format=binary` 直接返回图片字节（`Content-Type: image/png` 或 `image/jpeg`），适合存文件。

### 3.4 指定账号

多条 Grok CLI / xAI 登录时，用连接 id 钉死账号（Dashboard 试玩下拉里能看到）：

```bash
curl -sS -X POST "$BASE/v1/images/generations" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -H "x-connection-id: <grok-cli-connection-id>" \
  -d '{"model":"xai/grok-imagine-image","prompt":"霓虹雨夜的街道"}'
```

### 3.5 JavaScript

```js
const res = await fetch(`${process.env.NINEROUTER_URL}/v1/images/generations`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.NINEROUTER_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "xai/grok-imagine-image",
    prompt: "水彩山景，日出",
    aspect_ratio: "16:9",
    resolution: "1k",
    n: 1,
  }),
});
const body = await res.json();
if (!res.ok) throw new Error(body?.error?.message || res.statusText);
console.log(body.data[0].url);
```

改图：

```js
const res = await fetch(`${process.env.NINEROUTER_URL}/v1/images/edits`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.NINEROUTER_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "xai/grok-imagine-image",
    prompt: "改成铅笔素描",
    image: { url: "https://example.com/ref.png", type: "image_url" },
    aspect_ratio: "auto",
  }),
});
```

OpenAI SDK（打 9router，不要打 api.x.ai）：

```js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.NINEROUTER_KEY,
  baseURL: `${process.env.NINEROUTER_URL}/v1`,
});

const gen = await client.images.generate({
  model: "xai/grok-imagine-image",
  prompt: "一只红色的苹果",
  n: 1,
  extra_body: { aspect_ratio: "1:1", resolution: "1k" },
});
```

### 3.6 CLI

```bash
# 文生图
9router xai image --prompt "一只红色的苹果" --output apple.png

# 图生图（--image 最多 3 次）
9router xai image --prompt "改成素描" --image ./ref.png --output sketch.png

9router xai image \
  --prompt "把 <IMAGE_0> 放进 <IMAGE_1>" \
  --image ./person.png \
  --image ./scene.png \
  --aspect-ratio auto \
  --output out.png
```

常用参数：`--model` `--n` `--aspect-ratio` `--resolution` `--quality` `--file-id` `--api-key` `--port` `--host`。

---

## 4. 视频 API

视频是**异步任务**。创建接口立刻返回 `request_id`，再轮询直到 `done` 或失败。通常要几分钟，和时长、分辨率、是否改片有关。

创建请求 **不会自动重试**（重试可能双计费）。只有 401 刷新 token 后会再打一次，且发生在上游建任务之前。

### 4.1 标准流程

```
POST /v1/videos/generations|edits|extensions
        ↓
{ "request_id": "…" }
响应头 x-9router-connection-id: <连接 id>
        ↓
每隔几秒 GET /v1/videos/{request_id}
并回传 x-connection-id: <上一步的连接 id>
        ↓
status=done → 下载 video.url（临时链接，尽快保存）
```

任务和上游账号绑定。轮询必须带创建时返回的 `x-9router-connection-id`，写成请求头 `x-connection-id`。不带的话，多账号时可能问到别的号，查不到任务。

可选：创建时带 `Idempotency-Key`，网关原样转给上游。

### 4.2 文生视频

`POST /v1/videos/generations`

```bash
CREATE=$(curl -sS -D /tmp/vhdrs.txt -X POST "$BASE/v1/videos/generations" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "xai/grok-imagine-video",
    "prompt": "霓虹雨夜里的电影跟拍，镜头穿过小巷",
    "duration": 8,
    "aspect_ratio": "16:9",
    "resolution": "720p"
  }')

echo "$CREATE"
# {"request_id":"41eb9a5f-…"}

CONN=$(awk 'BEGIN{IGNORECASE=1} /^x-9router-connection-id:/{print $2}' /tmp/vhdrs.txt | tr -d '\r')
REQUEST_ID=$(echo "$CREATE" | jq -r .request_id)
```

`grok-imagine-video` 的文生视频内部是「先出首帧再动画」，中间图不会返回。

### 4.3 图生视频（锁定首帧）

同一接口，加上 `image`。输出默认跟输入图比例；若再传 `aspect_ratio`，会按该比例拉伸。

```bash
curl -sS -X POST "$BASE/v1/videos/generations" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "xai/grok-imagine-video",
    "prompt": "镜头缓慢前推，风吹动头发",
    "image": { "url": "https://example.com/still.png" },
    "duration": 6,
    "resolution": "720p"
  }'
```

`image` 也可以是 `{ "url": "data:image/jpeg;base64,…" }` 或 `{ "file_id": "file_…" }`。

### 4.4 参考图生视频（不锁首帧）

同一接口，用 `reference_images`（官方 **最多 7 张**）。适合虚拟试穿、角色一致、产品植入。prompt 里用 **`<IMAGE_1>` … `<IMAGE_7>`**（视频从 1 起算，和图片改图的 `<IMAGE_0>` 不同）。

```bash
curl -sS -X POST "$BASE/v1/videos/generations" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "xai/grok-imagine-video-1.5",
    "prompt": "<IMAGE_1> 的人穿着 <IMAGE_2> 的衣服走上 T 台",
    "reference_images": [
      {"url": "https://example.com/person.png"},
      {"url": "https://example.com/shirt.png"}
    ],
    "duration": 10,
    "aspect_ratio": "16:9",
    "resolution": "720p"
  }'
```

`grok-imagine-video-1.5` 还可以带预设音色（最多 3 个），prompt 里用 `<AUDIO_0>` `<AUDIO_1>` `<AUDIO_2>`：

```json
{
  "model": "xai/grok-imagine-video-1.5",
  "prompt": "<IMAGE_1> 对着镜头说话，声音用 <AUDIO_0>",
  "reference_images": [{"url": "https://example.com/person.png"}],
  "reference_audios": [{"voice_id": "eve"}],
  "duration": 8,
  "aspect_ratio": "9:16",
  "resolution": "720p"
}
```

`voice_id` 与 xAI TTS 内置音色相同（如 `eve`），大小写不敏感。未知 id 上游会 400 并返回可用列表。自备音频参考仅对官方合作账号开放。参考图生视频最高 **720p**。

一次请求只能选一种模式：纯 prompt、或 `image`、或 `reference_images` / `reference_audios`。不要混用 `image` 和 `reference_images`。

### 4.5 改视频

`POST /v1/videos/edits`

```bash
curl -sS -X POST "$BASE/v1/videos/edits" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "xai/grok-imagine-video",
    "prompt": "给女人加一条银项链",
    "video": { "url": "https://example.com/source.mp4" }
  }'
```

`video` 也可以是 data URI 或 `{ "file_id": "file_…" }`。

改视频时 **`duration` / `aspect_ratio` / `resolution` 无效**：输出跟片源走。片源时长上限约 8.7 秒；分辨率上限 720p（1080p 片源会被压到 720p）。

### 4.6 续视频

`POST /v1/videos/extensions`

从最后一帧接着往下生成，返回的是「原片 + 续段」拼在一起的一条视频。

```bash
curl -sS -X POST "$BASE/v1/videos/extensions" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "xai/grok-imagine-video",
    "prompt": "镜头缓缓拉远，露出城市天际线",
    "video": { "url": "https://example.com/clip.mp4" },
    "duration": 6
  }'
```

这里的 `duration` 只控制**续出来的那一段**，不是成片总长。例如原片 10 秒 + `duration: 5` → 约 15 秒。续视频的 `duration` 上游要求 **2–10**，传 `1` 会失败。

### 4.7 轮询任务

`GET /v1/videos/{request_id}`

```bash
curl -sS "$BASE/v1/videos/$REQUEST_ID" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "x-connection-id: $CONN"
```

| `status` | 含义 |
|---|---|
| `pending` | 还在生成，可看 `progress`。轮询时网关可能返回 **HTTP 202** |
| `done` | 完成，读 `video.url`（HTTP 200） |
| `failed` | 失败，读 `error` |
| `expired` | 任务过期 |

完成时大致是：

```json
{
  "status": "done",
  "video": {
    "url": "https://vidgen.x.ai/.../video.mp4",
    "duration": 8,
    "respect_moderation": true
  },
  "model": "grok-imagine-video",
  "progress": 100
}
```

`video.url` 是临时链接。建议下载后自己存。生成的视频默认带音轨。

轮询示例：

```bash
while true; do
  RESULT=$(curl -sS "$BASE/v1/videos/$REQUEST_ID" \
    -H "Authorization: Bearer $NINEROUTER_KEY" \
    -H "x-connection-id: $CONN")
  STATUS=$(echo "$RESULT" | jq -r .status)
  echo "$STATUS $(echo "$RESULT" | jq -r '.progress // empty')"
  case "$STATUS" in
    done) echo "$RESULT" | jq -r .video.url; break ;;
    failed|expired) echo "$RESULT"; break ;;
  esac
  sleep 5
done
```

### 4.8 视频请求字段

网关对视频 **原样转发** JSON（或 multipart 字节）。官方字段都能用。

| 字段 | 用在 | 说明 |
|---|---|---|
| `model` | 全部 | `xai/grok-imagine-video` 或 `xai/grok-imagine-video-1.5`。前缀会被剥掉再转给上游 |
| `prompt` | 全部 | 文生必填；图生可选；改/续必填 |
| `duration` | 生 / 续 | 秒。文生/图生实测 `1` 可用；**续视频上游要求 2–10 秒**（传 `1` 会 `failed: Duration must be between 2 and 10 seconds`）。改视频无效。续视频只表示续段长度 |
| `aspect_ratio` | 生 | `1:1` `16:9` `9:16` `4:3` `3:4` `3:2` `2:3`。默认 `16:9`。图生默认跟输入图。改视频无效 |
| `resolution` | 生 | `480p`（默认）`720p` `1080p`。`1080p` 需要 `grok-imagine-video-1.5` 的文生/图生。参考图模式最高 720p。改视频无效 |
| `image` | 图生视频 | `{ "url" }` 或 `{ "file_id" }`。**只锁 1 张首帧**，不能和 `reference_images` 混用 |
| `reference_images` | 参考图生视频 | `[{ "url" }]` 或 `file_id`。**最多 7 张**。prompt 用 `<IMAGE_1>` 起 |
| `reference_audios` | 1.5 参考音色 | `[{ "voice_id": "eve" }]`，最多 3 个 |
| `video` | 改 / 续 | `{ "url" }` / data URI / `{ "file_id" }` |

### 4.9 JavaScript

```js
const base = process.env.NINEROUTER_URL;
const key = process.env.NINEROUTER_KEY;

const create = await fetch(`${base}/v1/videos/generations`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "xai/grok-imagine-video",
    prompt: "霓虹雨夜里的电影跟拍",
    duration: 8,
    aspect_ratio: "16:9",
    resolution: "720p",
  }),
});
const created = await create.json();
if (!create.ok) throw new Error(created?.error?.message || create.statusText);

const requestId = created.request_id;
const connectionId = create.headers.get("x-9router-connection-id");

for (;;) {
  const poll = await fetch(`${base}/v1/videos/${requestId}`, {
    headers: {
      Authorization: `Bearer ${key}`,
      ...(connectionId ? { "x-connection-id": connectionId } : {}),
    },
  });
  const job = await poll.json();
  if (job.status === "done") {
    console.log(job.video.url);
    break;
  }
  if (job.status === "failed" || job.status === "expired") {
    throw new Error(job.error?.message || job.status);
  }
  await new Promise((r) => setTimeout(r, 5000));
}
```

### 4.10 CLI

```bash
9router xai video \
  --prompt "霓虹雨夜里的电影跟拍" \
  --duration 8 \
  --aspect-ratio 16:9 \
  --resolution 720p \
  --output video.mp4

# 图生视频
9router xai video --prompt "镜头前推" --image ./still.png --output out.mp4
```

CLI 会创建、轮询（默认最多等 600 秒）、下载到 `video.mp4.part`，成功后再原子改名。Ctrl+C 会干净退出。

常用参数：`--model` `--timeout` `--api-key` `--port` `--host`。

CLI 目前只封装 **generations**（文生 / 图生）。改视频、续视频、参考图请直接打 HTTP。

---

## 5. 和聊天的区别

| | 聊天 | 图片 | 视频 |
|---|---|---|---|
| 页面 | Providers → Grok CLI | Media → Text to Image → xAI | Media → Video → xAI |
| 模型 | `gcli/grok-4.6` 等 | `xai/grok-imagine-image*` | `xai/grok-imagine-video*` |
| 上游 | `cli-chat-proxy.grok.com` | `api.x.ai/v1/images/*` | `api.x.ai/v1/videos/*` |
| 凭证 | Grok CLI 登录 | 同一套即可 | 同一套即可 |
| 列表 | `GET /v1/models` | `GET /v1/models/image` | 无独立列表，直接用模型 ID |

生图限流锁的是图像模型，**不会**把 `gcli/*` 聊天锁死。

---

## 6. 常见错误

| 现象 | 原因 | 怎么办 |
|---|---|---|
| `Log in to Grok CLI (Grok Build), or add an xAI API key.` | 两边都没登 | 先登 Grok CLI，或加 xAI Key |
| `Grok Build login expired. Reconnect it under Providers → Grok CLI.` | 订阅 token 过期 | Providers → Grok CLI 重新登录 |
| `This Grok Build plan cannot use Imagine...` | 档位不含 Imagine（常见 Free / X Basic） | grok.com 升级，或改用 console.x.ai Key |
| `This xAI API key is invalid...` | Key 无效 | Providers → xAI (Grok) 更换 |
| `The model grok-2-image-1212 was deprecated` | 旧图像模型已下线 | 改用 `xai/grok-imagine-image` |
| `Missing required field: image` | 打了 `/v1/images/edits` 但没参考图 | 传 `image` 或 `images` |
| `Grok Imagine does not support masks.` | 传了 mask | 删掉 `mask` / `mask_image` |
| `Grok Imagine accepts at most 3 reference images.` | 图片改图参考图超过 3 张 | 减到 ≤ 3（这是生图上限，不是视频） |
| `Reference image exceeds 20 MB` | 本地读入的图太大 | 压缩，或改传公网 URL |
| `Reference images must be JPEG, PNG, or WebP.` | 格式不对 | 换格式 |
| `Send either "image" or "images", not both.` | 两个字段一起传了 | 只留一个 |
| `Use POST /v1/images/edits for multipart image edits` | multipart 打到了 `/v1/images/generations` | 改打 `/v1/images/edits` |
| `Invalid aspect_ratio` / `Invalid resolution` | 图片参数不在白名单 | 用 §3.3 的枚举（分辨率是 `1k`/`2k`，不是 `720p`） |
| 视频轮询一直查不到 / 404 | 没带回创建时的连接 | 把 `x-9router-connection-id` 回传为 `x-connection-id` |
| `Combos are not supported for video generation` | 视频 `model` 写成了 combo 名 | 用 `xai/grok-imagine-video` |
| `Provider '…' does not support video generation` | 带了非 xai 前缀 | 只用 `xai/` |

额度耗尽一般是 **402**；限流是 **429**。403 多半是套餐没有 Imagine。5xx 不要立刻重发创建请求，上游可能已经建了任务。

---

## 7. 给下游业务

1. 图像默认写死 `xai/grok-imagine-image`（或 quality / 2.0）。视频默认 `xai/grok-imagine-video`；要 1080p / 参考音色再用 `xai/grok-imagine-video-1.5`。
2. 鉴权只用 9router Key。不要把 Grok / xAI token 下发。
3. 不要教 `gcli/grok-imagine-*`。
4. 消耗的是 Grok Build 订阅额度或 xAI API 计费，不是 9router 自己的余额。
5. 图片 URL、视频 URL 都会过期。业务侧下载落盘。
6. 创建类接口（出图、出视频、改、续）不要做自动重试。
7. 视频必须保存并回传 `x-9router-connection-id`。
8. 图片改图用 `<IMAGE_0>` 起算；视频参考图用 `<IMAGE_1>` 起算。
9. 图片分辨率是 `1k`/`2k`；视频分辨率是 `480p`/`720p`/`1080p`。不要混用。
10. 9router 不提供 Files 上传。参考素材优先公网 URL 或 data URI。

官方协议备查：

- 图像：<https://docs.x.ai/developers/model-capabilities/images/generation>
- 改图：<https://docs.x.ai/developers/model-capabilities/images/editing>
- 视频：<https://docs.x.ai/developers/model-capabilities/video/generation>
- REST：<https://docs.x.ai/developers/rest-api-reference/inference/images> · <https://docs.x.ai/developers/rest-api-reference/inference/videos>
