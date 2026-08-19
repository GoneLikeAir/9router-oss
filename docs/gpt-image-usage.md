# OpenAI 兼容 Images 节点使用说明

> 相对官方 decolua/9router 的改动总览见 [`vs-upstream.md`](./vs-upstream.md)。

用 9router 把 **只提供 OpenAI Images API**（`/v1/images/generations`、`/v1/images/edits`）的上游挂进来。这类节点 **不能** 用来聊天。

下文示例前缀是 `imgnode`，Base URL 是 `https://images.example.com/v1`。换成你自己节点上的 prefix 和地址即可。

---

## 1. 在 Dashboard 里加节点

1. Providers → **OpenAI Compatible** → 添加节点。
2. **API Type** 选 **Images API**（不要选 Chat / Responses）。
3. Prefix 例如 `imgnode`。模型 ID 会变成 `{prefix}/gpt-image-2`。
4. Base URL 停在 `/v1`。网关会自己拼 `/images/generations` 和 `/images/edits`。
5. 勾选 Text to image / Image to image。
6. Check 只打 `GET /models`，**不会真生图、不会扣费**。探活失败仍可创建；上游要代理就在连接上开 proxy。
7. 给这个节点加 API Key 连接。不要拿去聊天。

之后模型出现在 `GET /v1/models/image`，**不会**出现在聊天目录或 Basic Chat 下拉。对聊天接口会 400：`is an images node. Use POST /v1/images/generations or /v1/images/edits.`

---

## 2. 模型 ID

| 模型 ID | 说明 |
|---|---|
| `{prefix}/gpt-image-2` | 钉死某一个 Images 节点 |
| 自己在 Dashboard 配的 combo 名（例如 `gpt-image-2`） | 按 combo 策略在多个带前缀的模型之间回退 |

`GET /v1/models/image` 会列出 combo 名（`owned_by: combo`）。`GET /v1/models/info?id=<combo名>` 对 combo 名会 404，属正常。

---

## 3. 接口

| 场景 | 路径 | 模型怎么写 |
|---|---|---|
| 文生图 | `POST /v1/images/generations` | combo 名或带前缀都可以 |
| 图生图 | `POST /v1/images/generations` + `image` / `images` | **combo 名可以**。网关见到参考图会改打上游 `/images/edits` |
| 图生图 | `POST /v1/images/edits` | **必须带前缀**（如 `imgnode/gpt-image-2`） |

`/v1/images/edits` **不展开 combo**。只写 combo 名会立刻 400 `Invalid model format`。

参考图写法：`image`（单张）或 `images`（多张）。值可以是 URL、data URI、raw base64。单张 ≤ 20 MB。网关对 OpenAI 兼容图片节点**不截张数**，全部转成上游 multipart 的 `image` 字段。上游自己的张数上限以对方文档为准。

---

## 4. 调用

若开了 `REQUIRE_API_KEY`，请求头带 9router 自己的 Key（Dashboard → Keys），**不是**上游的 `sk-`。

```bash
NINEROUTER_KEY=$(sqlite3 "${DATA_DIR:-$HOME/.9router}/db/data.sqlite" \
  "SELECT key FROM apiKeys WHERE name='Default Key' LIMIT 1;")
```

文生图：

```bash
curl -sS -X POST "$NINEROUTER_URL/v1/images/generations?response_format=binary" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"imgnode/gpt-image-2","prompt":"一只红色的苹果，静物摄影，白底","n":1,"quality":"low"}' \
  --output apple.png
```

图生图（combo 名走 generations，可带多张）：

```bash
curl -sS -X POST "$NINEROUTER_URL/v1/images/generations" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-image-2","prompt":"把这些色块拼成一张拼贴","images":["https://example.com/a.png","https://example.com/b.png"],"quality":"low"}'
```

钉死上游、走 edits：

```bash
curl -sS -X POST "$NINEROUTER_URL/v1/images/edits" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"imgnode/gpt-image-2","prompt":"把苹果改成绿色","image":"https://example.com/apple.png"}'
```

---

## 5. 常见错误

| 现象 | 原因 | 怎么办 |
|---|---|---|
| `Invalid model format` | combo 名打到了 `/v1/images/edits` | 改打 `/v1/images/generations`，或模型写成 `{prefix}/…` |
| `is an images node` | 把图片节点拿去聊天 | 改打 `/v1/images/generations` 或 `/v1/images/edits` |
| `Reference image exceeds 20 MB` | 单张超过网关限制 | 压缩后再传 |
| 连接代理超时 / `Proxy required but failed` | 该连接开了 proxy，但代理不可用 | 检查连接上的 proxy；不要关真正需要的代理 |
| 上游 4xx / 5xx | 对方自己的限额、风控或网关 | 看上游返回，不要假设 9router 会截张数 |

探活不要真生图。Check 只打 `GET /models`。
