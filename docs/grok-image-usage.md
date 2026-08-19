# Grok 图像模型使用说明

> **完整接口文档（图片 + 视频）见 [`grok-media-api.md`](./grok-media-api.md)。**  
> 相对官方 decolua/9router 的全部改动见 [`vs-upstream.md`](./vs-upstream.md)。  
> 本文只保留图像速查；图生图、视频、轮询、字段枚举和错误表以完整接口文档为准。

用 9router 调用 xAI Imagine 生图。推荐走已登录的 **Grok CLI (Grok Build)** 订阅，不必再配 console.x.ai 的 API Key。

本地 / 本机网关默认 `http://127.0.0.1:20128`。把下文的 `$NINEROUTER_URL` 换成你的地址。

---

## 1. 能用哪些模型

调用时必须带 `xai/` 前缀，**不要**写成 `gcli/`。

| 模型 ID | 说明 |
|---|---|
| `xai/grok-imagine-image` | **推荐默认**。标准 Imagine 生图 |
| `xai/grok-imagine-image-quality` | 画质档 |
| `xai/grok-imagine-image-2.0` | Imagine Image 2.0 |
| `xai/grok-2-image-1212` | 已弃用。上游会 404，请改用上面三个 |

查看网关已挂出的图像模型：

```bash
curl -sS "http://127.0.0.1:20128/v1/models/image" \
  -H "Authorization: Bearer $NINEROUTER_KEY" | jq '.data[].id'
```

聊天模型（`gcli/grok-4.6` 等）不会出现在这个列表里，也不能用来生图。

---

## 2. 凭证（先做这一步）

下面两种 **任选其一** 即可：

1. **推荐**：Dashboard → **Providers** → **Grok CLI (Grok Build)**，用 device code 登录。连接保持 Active。
2. 备选：Providers → **xAI (Grok)** 添加 console.x.ai 的 API Key，或点 **xAI OAuth**（这和 Grok CLI 登录不是同一件事）。

不要：

- 再登一次「xAI」才以为能画图。Grok CLI 登过就可以。
- 指望 **Grok Web (Subscription)** cookie 生图，那条路打不通 Imagine。
- 在 Grok CLI 页找图像模型。那边只有聊天。

Free / X Basic 档位通常不含 Imagine。页面上会标 **Imagine not included**；调用会 403。

---

## 3. 在页面上怎么试

图像模型不在聊天下拉，也不在 Providers → Grok CLI。

1. 打开 Dashboard。
2. 左侧 **Media Providers** → **Text to Image**  
   `/dashboard/media-providers/image`
3. 点 **xAI (Grok)**。  
   只有 Grok CLI、没有 xAI Key 时，卡片应是 **Ready · Uses Grok Build login**，不是 `1 Connected`。
4. 进入  
   `/dashboard/media-providers/image/xai`
5. **Models** 里选模型；下面 **Example** 填 prompt，点 **Run**。

Connection 下拉里会出现 `Grok Build · 邮箱`，选中后请求会带真实 grok-cli 的 `x-connection-id`。不要在这页 Disable / Delete 这条登录（会误关聊天）。

---

## 4. API 调用

### 接口

`POST /v1/images/generations`

| 字段 | 必填 | 说明 |
|---|---|---|
| `model` | 是 | 如 `xai/grok-imagine-image` |
| `prompt` | 是 | 画面描述 |
| `n` | 否 | 张数，默认 1 |
| `response_format` | 否 | `url`（默认）或 `b64_json` |

xAI Imagine 转发 `model` / `prompt` / `n` / `response_format` / `aspect_ratio` / `resolution` / `storage_options`。`size` 仅在能映射到官方比例时转成 `aspect_ratio`（`auto` / 未知尺寸不传）。`quality` 只在 `grok-imagine-image-2.0` 且值为 `low`/`medium` 时转发。

另：`?response_format=binary` 直接返回图片字节，适合存文件。

生产上若开了 `REQUIRE_API_KEY`，请求头要带 9router 自己的 Key（Dashboard → Keys，例如 Default Key），**不是** xAI 的 `sk-`。

### 拿 Key

Dashboard → **Keys**（例如 Default Key）。本机 sqlite：

```bash
NINEROUTER_KEY=$(sqlite3 "${DATA_DIR:-$HOME/.9router}/db/data.sqlite" \
  "SELECT key FROM apiKeys WHERE name='Default Key' LIMIT 1;")
```

### 出图并保存

```bash
curl -sS -X POST "http://127.0.0.1:20128/v1/images/generations?response_format=binary" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"xai/grok-imagine-image","prompt":"一只红色的苹果，静物摄影，白底","n":1}' \
  --output apple.png
```

### 图生图

`POST /v1/images/edits`

三个现役模型都支持 edit：`xai/grok-imagine-image`、`xai/grok-imagine-image-quality`、`xai/grok-imagine-image-2.0`。`grok-2-image-1212` 已弃用，不要用来改图。

Against 9router you may send JSON or multipart; the gateway always calls xAI as JSON.

Do not point the OpenAI SDK `images.edit()` at api.x.ai — that path is multipart and xAI rejects it. Do not use a `gcli/` model prefix.

单图：

```bash
curl -sS -X POST "http://127.0.0.1:20128/v1/images/edits" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"xai/grok-imagine-image","prompt":"Render this as a pencil sketch","image":{"url":"https://docs.x.ai/assets/api-examples/images/style-realistic.png","type":"image_url"},"aspect_ratio":"auto"}'
```

多图（在 prompt 里用 `<IMAGE_0>` `<IMAGE_1>` 指代）：

```bash
curl -sS -X POST "http://127.0.0.1:20128/v1/images/edits" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"xai/grok-imagine-image","prompt":"Put the subject from <IMAGE_0> into the scene from <IMAGE_1>","images":[{"url":"https://example.com/person.png"},{"url":"https://example.com/scene.png"}]}'
```

也接受 OpenAI 习惯的 `image` 字符串（URL / data URI）或顶层 `image_url`。**最多 3 张**（官方 Imagine Image Editing；三个现役模型同一上限。grok.com 产品页有时写 Image 2.0 可 5 张，API 仍是 3）。`file_id`（`file_…`）会原样转给上游。9router 本版不提供 `/v1/files` 上传；请传 URL、data URI，或你已经拿到的 id。编辑按输入图 + 输出图计费。

视频参考图是另一套上限：**最多 7 张**（`reference_images`，且不能和锁首帧的 `image` 混用）。见 [`grok-media-api.md`](./grok-media-api.md) §4.4。

Dashboard：Media → Text to Image → xAI → Example 里把 Mode 切到 Image to image。

CLI：`9router xai image --prompt "…" --image ./ref.png --output image.png`

### JSON（拿 URL）

```bash
curl -sS -X POST "http://127.0.0.1:20128/v1/images/generations" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"xai/grok-imagine-image","prompt":"一只红色的苹果，静物摄影，白底","n":1}'
```

成功大致是：

```json
{
  "created": 1735000000,
  "data": [{ "url": "https://..." }]
}
```

`response_format=b64_json` 时 `data[0].b64_json` 为 Base64。

### 指定 Grok CLI 账号

多条 Grok CLI 登录时，用连接 id 钉死账号（Dashboard 试玩下拉里能看到）：

```bash
curl -sS -X POST "http://127.0.0.1:20128/v1/images/generations" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -H "x-connection-id: <grok-cli-connection-id>" \
  -d '{"model":"xai/grok-imagine-image","prompt":"霓虹雨夜的街道"}'
```

同时有 xAI API Key 和 Grok CLI 时：先走 xAI Key，失败（401/403/402/429）再落到 Grok CLI。

### JavaScript

```js
const res = await fetch("http://127.0.0.1:20128/v1/images/generations", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.NINEROUTER_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "xai/grok-imagine-image",
    prompt: "水彩山景，日出",
    n: 1,
  }),
});
const body = await res.json();
if (!res.ok) throw new Error(body?.error?.message || res.statusText);
console.log(body.data[0].url);
```

---

## 5. 常见错误

| 现象 | 原因 | 怎么办 |
|---|---|---|
| `Log in to Grok CLI (Grok Build), or add an xAI API key.` | 两边都没登 | 先登 Grok CLI，或加 xAI Key |
| `Grok Build login expired. Reconnect it under Providers → Grok CLI.` | 订阅 token 过期 | Providers → Grok CLI 重新登录 |
| `This Grok Build plan cannot use Imagine...` | 档位不含 Imagine（常见 Free / X Basic） | grok.com 升级，或改用 console.x.ai Key |
| `This xAI API key is invalid...` | Key 无效 | Providers → xAI (Grok) 更换 |
| `The model grok-2-image-1212 was deprecated` | 旧模型已下线 | 改用 `xai/grok-imagine-image` |
| `No credentials for provider: xai` | 旧行为，现网不应再出现 | 确认已部署当前版本，并已登录 Grok CLI |

额度耗尽一般是 402；限流是 429。聊天 `gcli/*` 不受生图锁定影响。

---

## 6. 和聊天、视频的区别

| | 聊天 | 生图 | 生视频 |
|---|---|---|---|
| 页面 | Providers → Grok CLI | Media → Text to Image → xAI | Media → Video → xAI |
| 模型前缀 | `gcli/` 或 `grok-cli/` | **`xai/`** | **`xai/`** |
| 上游 | cli-chat-proxy.grok.com | api.x.ai Imagine | api.x.ai `/v1/videos` |
| 凭证 | Grok CLI 登录 | 同一套 Grok CLI 登录即可 | 同一套 |

视频是异步任务（先拿 `request_id` 再轮询），图像是一次 POST 出图。完整调用说明见 [`grok-media-api.md`](./grok-media-api.md)。

---

## 7. 给下游业务

- 模型写死 `xai/grok-imagine-image`（或 quality / 2.0）。
- 鉴权用 9router Key，不要把 Grok / xAI token 下发给业务。
- 不要教 `gcli/grok-imagine-image`。
- 消耗的是 Grok Build 订阅额度（或 xAI API 计费），不是 9router 自己的余额。
