# 相对官方 decolua/9router 的改动

本仓库是 [decolua/9router](https://github.com/decolua/9router) 的下游镜像，不是 GitHub fork。

| | 地址 |
|---|---|
| 官方 | `https://github.com/decolua/9router`（建议本地加 `upstream`） |
| 当前对齐 | 官方 `v0.5.55` |

官方已有的 SAML、Alibaba Token Plan、Fish Audio、Gemini 3.7 等能力随合并进来，**不是**本仓库独有。下文只记相对 `upstream/master` 多出来的补丁。

核对差异：

```bash
git fetch https://github.com/decolua/9router.git master
git log --oneline FETCH_HEAD..HEAD
git diff --stat FETCH_HEAD...HEAD
```

---

## 1. 多了什么

| 能力 | 官方 | 本仓库 | 使用文档 |
|---|---|---|---|
| Grok CLI 登录给 Imagine 出图 / 出视频 | 生图必须配 xAI Key | 已登 Grok CLI 即可，不必再配 console.x.ai Key | 本文 §2，[`grok-image-usage.md`](./grok-image-usage.md)，[`grok-media-api.md`](./grok-media-api.md) |
| Grok Imagine 图生图 | 无 `/v1/images/edits` | `POST /v1/images/edits`，最多 3 张参考；出站永远是 JSON | 本文 §2.3 |
| OpenAI 兼容 **Images** 节点 | 兼容节点只有 chat / responses | 可建 `apiType=images`（文生图 + 图生图），不进聊天目录 | 本文 §3，[`gpt-image-usage.md`](./gpt-image-usage.md) |
| SuperGrok `grok-4.6` | 目录停在 4.5 | `gcli/grok-4.6` 及 high/medium/low；500k 上下文 | 本文 §4 |

相对官方 `v0.5.55` 的补丁（本仓库额外提交）：Grok CLI 凭证借用、Imagine 图生图、OpenAI 兼容 Images 节点、`grok-4.6` 目录。

---

## 2. Grok Imagine（图片 / 视频）

### 2.1 凭证

两种任选其一：

1. **推荐**：Dashboard → Providers → **Grok CLI (Grok Build)**，device code 登录，连接保持 Active。
2. 备选：Providers → **xAI (Grok)** 加 console.x.ai 的 API Key，或点 **xAI OAuth**（和 Grok CLI 登录不是同一件事）。

同时有 xAI Key 和 Grok CLI 时：先走 xAI Key，失败（401 / 403 / 402 / 429）再落到 Grok CLI。

不要：

- 再登一次「xAI」才以为能出图。Grok CLI 登过就可以。
- 指望 **Grok Web (Subscription)** cookie。那条路打不通 Imagine。
- 模型写成 `gcli/grok-imagine-image`。媒体必须用 **`xai/`**。聊天才用 `gcli/`。

Free / X Basic 通常不含 Imagine，页面会标 **Imagine not included**，调用会 403。

媒体页（Text to Image / Video → xAI）在只有 Grok CLI、没有 xAI Key 时，应显示 **Ready · Uses Grok Build login**，不是 `1 Connected`。不要在媒体页 Disable / Delete 这条 Grok CLI 登录（会误关聊天）。

### 2.2 文生图

模型（必须带 `xai/`）：

| 模型 ID | 说明 |
|---|---|
| `xai/grok-imagine-image` | **推荐默认** |
| `xai/grok-imagine-image-quality` | 画质档 |
| `xai/grok-imagine-image-2.0` | 可额外传 `quality`（`low` / `medium`） |
| `xai/grok-2-image-1212` | 已弃用，上游 404 |

```bash
curl -sS -X POST "$NINEROUTER_URL/v1/images/generations?response_format=binary" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"xai/grok-imagine-image","prompt":"一只红色的苹果，静物摄影，白底","n":1}' \
  --output apple.png
```

Dashboard：Media Providers → Text to Image → **xAI (Grok)** → Example → Run。

CLI：

```bash
9router xai image --prompt "水彩山景，日出" --output image.png
```

网关鉴权用的是 9router 自己的 Key（Dashboard → Keys），不是 xAI 的 `sk-`。

### 2.3 图生图

`POST /v1/images/edits`

三个现役模型都支持。对 9router 可发 JSON 或 multipart；**网关打 xAI 永远是 JSON**。不要把 OpenAI SDK 的 `images.edit()` 直接打到 `api.x.ai`（那是 multipart，xAI 会拒）。

**最多 3 张**参考图（官方 Imagine Image Editing；三个模型同一上限）。多图时在 prompt 里用 `<IMAGE_0>` `<IMAGE_1>` 指代。也接受 URL、data URI、顶层 `image_url`、或已有的 `file_id`。本仓库不提供 `/v1/files` 上传。

```bash
curl -sS -X POST "$NINEROUTER_URL/v1/images/edits" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"xai/grok-imagine-image","prompt":"Render this as a pencil sketch","image":{"url":"https://example.com/photo.png","type":"image_url"},"aspect_ratio":"auto"}'
```

多图：

```bash
curl -sS -X POST "$NINEROUTER_URL/v1/images/edits" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"xai/grok-imagine-image","prompt":"Put the subject from <IMAGE_0> into the scene from <IMAGE_1>","images":[{"url":"https://example.com/person.png"},{"url":"https://example.com/scene.png"}]}'
```

CLI：

```bash
9router xai image --prompt "改成铅笔速写" --image ./ref.png --output out.png
```

`--image` 可重复，合计（含 `--file-id`）最多 3。可选 `--aspect-ratio`、`--resolution 1k|2k`、`--quality`（仅 2.0）。

页面：同一 Example 把 Mode 切到 **Image to image**。

可选字段：`aspect_ratio`（`1:1` `16:9` `auto` 等）、`resolution`（`1k`/`2k`）、`n`、`response_format`。OpenAI 风格的 `size` 仅在能映射到官方比例时转成 `aspect_ratio`。不支持 mask。

### 2.4 视频（同一套 Grok CLI 登录）

模型：`xai/grok-imagine-video`、`xai/grok-imagine-video-1.5`。

视频是异步任务：先 `POST /v1/videos/generations` 拿 `request_id`，再 `GET /v1/videos/{request_id}` 轮询。

| 输入 | 上限 |
|---|---|
| 锁首帧 `image` | 1 张 |
| 参考图 `reference_images` | 最多 **7** 张；不能和锁首帧的 `image` 混用 |

页面：Media Providers → Video → **xAI (Grok)**。完整字段、轮询、改/续见 [`grok-media-api.md`](./grok-media-api.md)。

### 2.5 钉死某个 Grok CLI 账号

多条登录时：

```http
x-connection-id: <grok-cli-connection-id>
```

### 2.6 常见错误

| 现象 | 怎么办 |
|---|---|
| `Log in to Grok CLI (Grok Build), or add an xAI API key.` | 先登 Grok CLI，或加 xAI Key |
| `Grok Build login expired...` | Providers → Grok CLI 重新登录 |
| `This Grok Build plan cannot use Imagine...` | 升级 grok.com，或改用 console.x.ai Key |
| `The model grok-2-image-1212 was deprecated` | 改用 `xai/grok-imagine-image` |

额度耗尽一般是 402；限流是 429。聊天 `gcli/*` 不受生图锁定影响。

---

## 3. OpenAI 兼容 Images 节点

官方的 OpenAI Compatible 节点只能做 chat / responses。本仓库多一个 **Images API**。

典型用途：把只提供 `/v1/images/*` 的 OpenAI 兼容上游挂进 9router，模型 ID 形如 `imgnode/gpt-image-2`。

### 3.1 在 Dashboard 里加节点

1. Providers → **OpenAI Compatible** → 添加节点。
2. **API Type** 选 **Images API**（不要选 Chat）。
3. Prefix 例如 `imgnode`。模型会变成 `{prefix}/gpt-image-2`。
4. Base URL 停在 `/v1`，例如 `https://images.example.com/v1`。网关会自己拼 `/images/generations` 和 `/images/edits`。
5. 勾选 Text to image / Image to image。
6. Check 只打 `GET /models`，**不会真生图、不会扣费**。探活失败仍可创建；出网要代理就在连接上开 proxy。
7. 给这个节点加 API Key 连接。图片节点 **不要**拿去聊天。

之后模型出现在 `GET /v1/models/image`，**不会**出现在聊天目录或 Basic Chat 下拉。对聊天接口会 400：`is an images node. Use POST /v1/images/generations or /v1/images/edits.`

### 3.2 调用

| 场景 | 路径 | 模型怎么写 |
|---|---|---|
| 文生图 | `POST /v1/images/generations` | combo 名或带前缀都可以 |
| 图生图 | `POST /v1/images/generations` + `image` / `images` | combo 名可以。网关见到参考图会改打上游 `/images/edits` |
| 图生图 | `POST /v1/images/edits` | **必须带前缀**（`imgnode/gpt-image-2`），combo 名会立刻 400 |

参考图：`image`（单张）或 `images`（多张）。值可以是 URL、data URI、raw base64。单张 ≤ 20 MB。网关对这类节点**不截张数**，全部转成上游 multipart 的 `image`。

```bash
# 文生图（combo 名，若 Dashboard 已配 gpt-image-2 回退链）
curl -sS -X POST "$NINEROUTER_URL/v1/images/generations" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-image-2","prompt":"一只红色的苹果","n":1,"quality":"low"}'

# 钉死上游、图生图
curl -sS -X POST "$NINEROUTER_URL/v1/images/edits" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"imgnode/gpt-image-2","prompt":"把苹果改成绿色","image":"https://example.com/apple.png"}'
```

连接若开了 proxy（`strictProxy`），出网走连接代理。需要代理的主机不要关。

### 3.3 参考图张数

| 层 | 上限 |
|---|---|
| 9router 网关 | 不限张数；单张 20 MB |
| OpenAI 官方文档（GPT Image edits） | 16 |

上游自己的张数 / 体积限制以对方为准，网关不会替你截。combo 回退时，每一跳都要过该跳上游的限额。细节见 [`gpt-image-usage.md`](./gpt-image-usage.md)。

### 3.4 探活

自定义 Images 前缀的 Check **禁止真生图**，只确认模型出现在 `/v1/models/image`。旧版本曾对 400 写入 `modelLock_*`，本仓库已修。

---

## 4. SuperGrok grok-4.6

Grok CLI 聊天目录增加：

| 模型 ID | 说明 |
|---|---|
| `gcli/grok-4.6`（或 `grok-cli/grok-4.6`） | 默认 |
| `gcli/grok-4.6-high` / `-medium` / `-low` | 同一上游，带 `reasoning.effort` |

能力按 500k 上下文、64k 输出处理，不会误当成 grok-4 的 256k。这是**聊天**模型，不能拿来生图。

---

## 5. 和官方合并时要注意

再合官方时，不要丢掉这些补丁：

- `open-sse/handlers/imageProviders/openaiCompatNode.js`、`xai.js`、`xaiNormalize.js`
- `src/sse/handlers/imageEdit.js`、`src/app/api/v1/images/edits/route.js`
- `src/sse/services/xaiMediaCredentials.js`（Grok CLI token 借用，聊天路由保持隔离）
- `src/shared/constants/compatibleNodes.js`（`apiType=images`）
- `cli/src/cli/commands/xaiImage.js`
- grok-cli 的 `grok-4.6` 目录与 `supportsGrokCliReasoningEffort`

合并时保留 Grok Imagine 图生图、Grok CLI 凭证借用，以及 OpenAI 兼容 Images 节点。
