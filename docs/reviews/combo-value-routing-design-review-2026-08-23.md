# Combo 性价比自动调序（cost × recent latency）设计评审

**评审日期**：2026-08-23
**评审对象**：《9Router Combo 性价比自动调序》设计草案（cost × 近期耗时 EWMA 串行重排）
**基线代码**：`GoneLikeAir/9router-oss` @ `2cdb167b`（combo 核心与私有 fork 共用 `open-sse/services/combo.js`）
**性质**：DESIGN REVIEW ONLY —— 本 PR 不含任何 routing 实现，仅此评审文档。

---

## 结论（Verdict）

> ## **FEASIBLE WITH CHANGES**

**TL;DR**

方向是对的，接入点也确实存在且很干净（`open-sse/services/combo.js` 的 `handleComboChat` 第 282–294 行，紧挨 `getRotatedModels` 与 `reorderByCapabilities` 之间，正是设计说的"请求前重排"）。但草案里有 **两处结构性误判** 和 **一个反直觉的公式**，不改直接进入实现会做出一个"看起来在工作、实际学不到东西"的功能：

1. **流式请求下，combo 层量不到设计想要的那个"耗时"。** `handleComboChat` 调用的 `handleSingleModel` 在**上游响应头**到达时就 resolve 了（`open-sse/handlers/chatCore/streamingHandler.js:104-107` 直接 `return new Response(transformedBody, ...)`）。场景描述里"1、2 偶发很慢但不挂"的那个"慢"，绝大部分发生在 SSE body 里 —— 而 body 是在 combo 循环**退出之后**才开始流的。所以 EWMA 的**写入点不能在 combo.js 里计时**，必须挂到已有的 `buildOnStreamComplete`（那里已经有 `ttftAt`）+ 非流式/SSE→JSON 三条收尾路径上。好消息：TTFT 已经在测了，不用新造埋点。
2. **`softTimeout` 在当前架构上对流式请求基本不可实现**，一期应直接砍掉（详见 §5）。Response 一旦返回给客户端，combo 循环已经结束，没有任何回退位；要实现就得缓冲整条流，那等于毁掉 TTFT 和 SSE 语义。而且"双花"不是风险而是必然，还会双记 usage、双清账号错误态。
3. **`score = cost × (1 + latency/L0)` 配 `L0≈8s`，实际上几乎是纯成本排序。** 代入设计自己的 1/1.5/4：cost-4 渠道要等 cost-1 渠道慢到 ~56s 才会被选中（推导见 §6）。`L0` 不是"典型时延"而是"愿意为时间付多少钱"的价格常数，调参方向和字面直觉相反（L0 越大 → latency 越不重要）。建议改成量纲显式的线性形式。

另有 **8 个 MUST-FIX**（含 comparator NaN 会直接破坏 fallback 顺序、prompt cache 亲和性被公式忽略、位置 2/3 永远拿不到样本导致冷启动饿死、UI 会静默清掉 cost 配置）与若干 nice-to-have，见 §8。

**"默认关、可选、不与能力 auto-switch 揉开关、一期不做竞速"这几条自我约束是正确的，建议保留。**

---

## 0. 已核对的代码（本评审的事实基础）

| 关注点 | 位置 |
| --- | --- |
| combo 串行 fallback 主循环 | `open-sse/services/combo.js:280-382` |
| 拟接入点（rotation → autoSwitch → 循环） | `open-sse/services/combo.js:282-294` |
| round-robin + sticky 状态（进程内 Map） | `open-sse/services/combo.js:88`, `208-246` |
| 能力重排（稳定分层排序） | `open-sse/services/combo.js:63-82` |
| fusion 并行 + quorum-grace + withTimeout | `open-sse/services/combo.js:472-522`, `547-625` |
| 硬错误判定 / 冷却 / 退避 | `open-sse/services/accountFallback.js:23-50`, `config/errorConfig.js` |
| 5 个模态调用方 | `src/sse/handlers/{chat,search,fetch,imageGeneration,tts}.js` |
| combo 持久化（`models` = JSON 字符串数组） | `src/lib/db/repos/combosRepo.js:5-15`, `46-49` |
| 每 combo 策略配置袋 | `settings.comboStrategies[name]`（`src/app/api/settings/route.js:79`，`src/lib/db/repos/settingsRepo.js:19`） |
| TTFT 实测点 | `open-sse/utils/stream.js:68`, `81`, `384`, `461` → `open-sse/handlers/chatCore/streamingHandler.js:113-141` |
| 非流式 / SSE→JSON 时延 | `open-sse/handlers/chatCore/nonStreamingHandler.js:376`；`sseToJsonHandler.js:220`, `313` |
| 观测落库（默认关 + 定量裁剪） | `src/lib/db/repos/requestDetailsRepo.js:122-133`；`settingsRepo.js:42-43` |
| 现有流超时常量 | `open-sse/config/runtimeConfig.js:53`(stall 360s), `:56`(first chunk 200s) |
| 定价表（已可算成本） | `open-sse/providers/pricing.js:368-389` |
| 进程内状态失效钩子 | `src/app/api/combos/[id]/route.js:53-74`；`src/app/api/settings/route.js:90-97` |
| 既有单测范式（纯函数） | `tests/unit/combo-routing.test.js`, `tests/unit/combo-autoswitch.test.js` |

**先澄清草案对现网的描述**（核对结论：基本准确，一处需补充）：

- 「autoSwitch=能力重排」✅ 准确。`reorderByCapabilities` 只按输入模态能力分 3 档做**稳定**排序，与成本/时延完全无关。且 `autoSwitch` 参数在 `src/` 下**没有任何调用方传值**（grep `autoSwitch` in `src/` → 空），一律走默认 `true`。
- 「固定 fallback；round-robin+sticky；硬错误立刻下一家；无 cost/无 latency EWMA」✅ 准确（grep `ewma|EWMA|movingAverage|healthScore` in `open-sse/ src/` → 空，确认是 greenfield）。
- ⚠️ **草案漏了 capacity adapter**：`src/sse/handlers/chat.js:99` 的 `augmentModelsWithCapacityAdapter` 会在**没有任何成员满足硬能力**时，把全局 adapter 池模型**前插**到 `models[]` 里（`open-sse/services/capacityAdapter.js:92-100`）。这些模型**不是 combo 成员**、没有 cost 配置，且带 `withCapacityAdapterStripping` 包装。value 排序必须把它们排除在外（见 MUST-FIX 4）。
- ⚠️ 「硬错误立刻下一家」有例外：503/502/504 且 `cooldownMs ≤ 5000` 时会 `await setTimeout` 后才继续（`combo.js:345-349`）。这段等待会被算进"总耗时"，若把总耗时喂给 EWMA 会污染样本。

---

## 1. 可行性 / 接入点 / 与现有机制的冲突

**接入点：干净，就一处。**

`open-sse/services/combo.js` L282-294:

```js
  let rotatedModels = getRotatedModels(models, comboName, comboStrategy, comboStickyLimit);

  // Auto-switch: float models that satisfy the request's required capabilities to the front.
  if (autoSwitch) {
    const required = detectRequiredCapabilities(body);
    if (required.size > 0) {
      const reordered = reorderByCapabilities(rotatedModels, required);
      if (reordered[0] !== rotatedModels[0]) {
        log.info("COMBO", `auto-switch for [${[...required].join(",")}] → ${reordered[0]}`);
      }
      rotatedModels = reordered;
    }
  }
```

value 排序应插在 `getRotatedModels` 之后、`reorderByCapabilities` **之前**。理由见下面的"分层顺序"。设计说的"默认定请求前重排"与此完全吻合，无需改动主循环（`296-361`）的任何一行 —— 这是本方案最大的可行性优势：**它是一次纯排序注入，不触碰错误处理、重试、`retryAfter` 聚合、SSE 管线。**

### 1.1 分层顺序：草案写反了，但语义可以救

草案分层写的是「(1) 能力重排 → (2) 合格子集 value 排序」。按字面实现需要写一个"分档内二次排序"的组合 comparator，要改 `reorderByCapabilities` 的签名。

**更省的做法是把应用顺序反过来**：先 value 排序，再原封不动地过一遍现有 `reorderByCapabilities`。因为它是**稳定**分层排序（`combo.js:78-81` 显式用 `a.t - b.t || a.i - b.i` 保稳定），value 排序的结果会自然成为**档内次序**，语义上就是草案要的"合格子集内按 value 排"，而 `reorderByCapabilities` **一行都不用改**。

反过来（先能力后 value）则会把不具备 vision 的便宜模型顶到最前面，导致图片在 `stripUnsupportedModalities`（`open-sse/handlers/chatCore.js:154`）里被剥掉、请求语义静默受损。**这是必须钉死的顺序约束，建议在代码注释里写明原因。**

### 1.2 与 round-robin / sticky 的冲突：互斥，不要做正交开关

草案提议 `routingMode: static|value` 作为**独立于** `fallbackStrategy` 的开关。**不建议。**

- `comboStrategy` 在 5 个 handler 里是**一个字符串分支**（`chat.js:98,102`、`search.js:76`、`fetch.js:95`、`imageGeneration.js:71`、`tts.js:51`），并直接透传给 `getRotatedModels`。加一个正交维度要改 5 个调用点 + `handleComboChat` 签名 + 5 处日志行。
- 语义上二者本就互斥：round-robin 每请求轮转 index（`combo.js:220-234`），value 排序会把它的输出立刻按分数重排 —— round-robin 变成纯粹的无效副作用（还在推进 `consecutiveUseCount`）。
- **建议**：`fallbackStrategy: "value"` 作为第四种取值（现有三种：`fallback` / `round-robin` / `fusion`）。既有 combo 没有该字段 → 天然满足"默认关"。

⚠️ **不要允许全局 `settings.comboStrategy = "value"`**。全局值会应用到所有没有 per-combo 配置的 combo（`chat.js:98` 的 `|| settings.comboStrategy`），而 cost 是 per-combo 的 —— 结果是所有 combo 的 cost 全默认 1，退化成**纯时延排序**，静默改变现网所有 combo 的行为。value 必须只能 per-combo 启用。

### 1.3 与 fusion 的冲突：无，但要显式挡掉

fusion 走完全独立的分支（`chat.js:102-120` → `handleFusionChat`），根本不经过 `handleComboChat`。二者互斥且已经互斥。**但**：`fallbackStrategy` 是单值字段，所以 `"value"` 与 `"fusion"` 自动互斥，无需额外代码 —— 只需在 UI 上是单选。

### 1.4 跨模态副作用：必须显式 opt-in

`handleComboChat` 被 **5 个模态**共用：chat、search、fetch、imageGeneration、tts。在 tts / imageGeneration 语境下，"TTFT"没有意义（`getRotatedModels` 之后走的是完全不同的 core），成本模型也不同（图片按张计费，不按 token）。

**MUST-FIX**：value 分支只在 chat 路径生效。最省的做法是给 `handleComboChat` 加一个默认关闭的参数（例如 `valueRouting`），只有 `src/sse/handlers/chat.js` 传入；其余 4 个调用方不传 → 行为字节级不变。**不要**靠"用户不会在 media combo 上开 value"来保证。

---

## 2. 当前流式路径能测到 TTFT 吗？—— 能，但不在 combo 层

**能测，而且已经在测了。** 这是本次评审最好的消息，也是最容易踩错的地方。

`open-sse/utils/stream.js:68,81` 在 transform 里记录首个非空 chunk 的时刻，透传到：

`open-sse/handlers/chatCore/streamingHandler.js` L113-141:

```js
export function buildOnStreamComplete({ provider, model, connectionId, apiKey, requestStartTime, ... }) {
  const streamDetailId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  const onStreamComplete = (contentObj, usage, ttftAt) => {
    const latency = {
      ttft: ttftAt ? ttftAt - requestStartTime : Date.now() - requestStartTime,
      total: Date.now() - requestStartTime
    };
```

三条收尾路径都已产出 `{ttft, total}`：
- 流式：`streamingHandler.js:116-120`（真 TTFT + 真总耗时）
- 非流式：`nonStreamingHandler.js:376`（`ttft === total`，只有总耗时）
- provider 强制流式→JSON：`sseToJsonHandler.js:220,313`（同上）

**但是 —— 关键结构性问题：`handleComboChat` 永远看不到这些值。**

`open-sse/handlers/chatCore/streamingHandler.js` L104-107:

```js
  return {
    success: true,
    response: new Response(transformedBody, { headers: SSE_HEADERS })
  };
```

`transformedBody` 是一个**还没开始流**的 stream。`handleSingleModel` 在这里 resolve → `combo.js:305` 的 `await` 返回 → `result.ok` 为真 → `combo.js:310` 直接 return。**combo 循环在第一个 token 之前就退出了。**

所以：
- ❌ 在 combo.js 里包一层 `Date.now()` 前后差，流式请求量到的是**上游响应头时延**（≈TCP+TLS+排队+prefill 的一部分），不是 TTFT，更不是总耗时。而场景描述的"偶发很慢但不挂"恰恰主要体现在 body 里（prefill 慢、token 吐得慢、中途卡顿）。**这样实现出来的 EWMA 会几乎学不到设计想治的那个病。**
- ✅ 正确做法：EWMA 的**写入点**放在上述三条收尾路径，**读取点**放在 combo.js。也就是说这个 feature 天然是**跨 `src/sse` ↔ `open-sse` 边界的双端改动**，不是"只改 combo.js"。

**建议的最小结构**（伪代码，非本 PR 实现）：

```
open-sse/services/comboValueStats.js
  recordSample({ provider, model, ttftMs, totalMs, ok })   // 由三条收尾路径调用
  getStats(modelStr) -> { ewmaMs, samples, lastAt, failRate }
  resetComboValueStats()                                    // 显式清空
```

- 写入点只需在 `buildOnStreamComplete` 内 `onStreamComplete` 里加一行、`nonStreamingHandler` / `sseToJsonHandler` 各一行。三处都在 `catch`/`.catch(() => {})` 保护的收尾区，符合 `open-sse` 的 **fail-open** 约定（参见 `open-sse/AGENTS.md` 关于 `rtk/` 的 pitfalls）—— 统计写入**绝不能抛出到请求路径**。
- 注意写入点在 `open-sse/handlers/chatCore/*`，那里拿到的是 `{provider, model}` 两个字段，而 combo 的 key 是 `"provider/model"` 字符串。要保证拼接口径与 `parseModel` / `reorderByCapabilities`（`combo.js:69-71` 用 `indexOf("/")` 首个斜杠切分）一致，否则带斜杠的上游 model id（如 `anthropic/claude-opus-4.6`，见 `pricing.js:158`）会 key 错位、样本永远匹配不上。**这是个很容易静默失效的坑，建议直接复用一个 `buildMemberKey()` 工具函数，并加单测。**

### 2.1 观测指标该选 TTFT 还是总耗时？

草案说"观测 TTFT 或总耗时"，留了模糊。**建议明确：以 TTFT 为主，总耗时仅作辅助（或不用）。**

- 总耗时与**输出长度强相关**，而输出长度由请求本身决定，不是渠道属性。同一 combo 上一个 200-token 回答和一个 8000-token 回答，总耗时差一个数量级 —— 直接喂 EWMA 等于往里灌噪声，会让"最近碰巧被问了长问题"的渠道被降权。
- TTFT 主要反映排队 + prefill，正是"渠道拥塞/被限速但没挂"的信号，也正是用户感知到的"卡"。
- 若真想用总耗时，必须归一化为 **ms/output_token**（`onStreamComplete` 的 `usage` 里有 `completion_tokens`，就在同一个回调内，成本为零）。这比原始总耗时可用得多，建议作为二期的 `throughput` 项。

⚠️ 另注：非流式路径拿不到真 TTFT（`ttft === total`）。若一个 combo 同时被流式和非流式客户端使用，两种样本混在一个 EWMA 里不可比。**建议只采集流式样本，或按 `stream` 分桶。**

---

## 3. `models[]` 怎么携带 cost 而不破坏现有 combo

**结论：绝对不要把 `models[]` 从字符串数组改成对象数组。**

`models` 是 JSON 化的**字符串数组**（`combosRepo.js:11` `parseJson(row.models, [])`，`:48` `stringifyJson(combo.models)`），被以下位置以字符串语义硬依赖：

| 依赖方 | 依赖形态 |
| --- | --- |
| `combo.js:69-71` `tierOf` | `typeof m === "string"`、`m.indexOf("/")`、`m.slice(...)` |
| `combo.js:191-198` `rotateModelsFromIndex` | 数组元素直接透传给 `handleSingleModel` |
| `combo.js:254-266` `getComboModelsFromData` | 返回 `combo.models` 原样 |
| `capacityAdapter.js:95-99` | `models.some((m) => modelSatisfies(m, hard))`、`models.includes(m)` |
| `capacityAdapter.js:160-172` | `new Set(adapterModels)` + `adapterSet.has(modelStr)` |
| `src/sse/handlers/chat.js:100` | `augmentedModels.filter((m) => !comboModels.includes(m))` |
| UI | `src/shared/components/ComboFormModal.js`、`dashboard/combos/page.js`、`media-providers/combo/[id]/page.js` |
| CLI | `cli/src/cli/menus/combos.js`（**独立发布的 npm 包，版本独立**） |
| 云端 | 私有 fork 的 `cloud/` worker（本仓库不含，但共用 `combo.js`） |

改成对象数组会同时破坏 **Set/includes 的引用语义**（对象比较）、**CLI 的独立发布节奏**（旧 CLI 读新 schema）和**云同步的双向兼容**。收益（少一层查表）远小于代价。

**推荐方案：cost 放进已有的 per-combo 配置袋 `settings.comboStrategies[comboName]`。**

这个袋子已经承担了完全同类的职责 —— `fallbackStrategy`、`judgeModel`、`fusionTuning`（`chat.js:117-118`）。加两个键即可：

```jsonc
// settings.comboStrategies["opus-pool"]
{
  "fallbackStrategy": "value",
  "memberCost": { "cc/claude-opus-4.6": 1, "tokenrouter/anthropic/claude-opus-4.6": 1.5, "anthropic/claude-opus-4-6": 4 },
  "valueTuning": { "latencyWeightPerSec": 0.02, "ewmaHalfLifeMs": 600000, "hysteresisRatio": 0.15, "minSamples": 5, "staleAfterMs": 1800000 }  // 完整键见 §9
}
```

优点：`combos` 表 schema 零改动、无迁移（`src/lib/db/migrations/001-initial.js` 不用动）、CLI 与旧 UI 天然向后兼容（未知键忽略）、云同步走 settings 既有通道。

⚠️ **但这个方案有两个现存 UI bug 会静默吞掉 cost 配置，必须一并修（MUST-FIX 7）**：

`src/app/(dashboard)/dashboard/combos/page.js` L164-173:

```jsx
  const handleSetComboStrategy = async (comboName, patch) => {
    try {
      const updated = { ...comboStrategies };
      const next = { ...(updated[comboName] || {}), ...patch };
      // Prune to keep settings clean: default fallback with no extras = no entry.
      if (!next.fallbackStrategy || next.fallbackStrategy === "fallback") {
        delete updated[comboName];
```

把策略切回 `fallback` 会**整条删除** entry → 用户辛苦填的 `memberCost` 一起消失，切回 `value` 时要重填。

`src/app/(dashboard)/dashboard/media-providers/combo/[id]/page.js` L156-158:

```jsx
    const updated = { ...(s.comboStrategies || {}) };
    if (enabled) updated[combo.name] = { fallbackStrategy: "round-robin" };
    else delete updated[combo.name];
```

这里是**整体覆盖**（不是 merge）→ 在 media combo 页面开一次 round-robin，就把该 combo 的 `memberCost` / `judgeModel` / `fusionTuning` 全部抹掉。**这是既有 bug，只是加了 `memberCost` 之后后果变严重。**

### 3.1 cost 其实不必全靠手填

`open-sse/providers/pricing.js:368` 的 `getPricingForModel(provider, model)` 已经能给出 `$/1M token`，三级回退（`PROVIDER_PRICING` → `MODEL_PRICING` → glob `PATTERN_PRICING`）。而 `PROVIDER_PRICING.tokenrouter`（`pricing.js:154-266`）正是"同一个模型在不同转售渠道价格不同"的现成表达 —— 恰好就是设计场景里 1/1.5/4 的来源。

**建议**：`memberCost` 定位为 **override**，缺省从 pricing 表推导（例如 `input + 3×output` 的加权，或直接用 `output` 单价做代理）。这样用户开箱即用，只在必要时手填。

⚠️ **但 pricing 表对订阅/OAuth 渠道是错的**：Claude Code / Copilot / Kiro / Qoder 这类订阅制或配额制渠道的**边际成本≈0**（钱已经按月付了），而 pricing 表给的是 API 名义价（如 `claude-opus-4.6` = `$5/$25`）。若不加 override，value 排序会把"已经付过钱的订阅渠道"和"按量计费的 API"按同一把尺子比，得出完全错误的结论 —— **而这恰恰是 9router 最典型的部署形态**。所以 `memberCost` 手填能力**必须保留**，且 UI 上应提示"订阅渠道建议填 0 或极小值"。

---

## 4. EWMA 存内存还是 sqlite？（多进程 / 重启）

**结论：进程内内存（挂 `globalThis`），不落库；重启即冷启动，靠"陈旧回归中性"兜底。**

理由：

1. **有现成先例且语义一致**：round-robin 的 `comboRotationState` 就是进程内 `Map`（`combo.js:88`），同样是"丢了不影响正确性、只影响优化质量"的软状态。EWMA 完全同类。
2. **不能每请求写 sqlite。** 驱动链是 `bun:sqlite` → `better-sqlite3`（**optional** 依赖，很多安装没有）→ `node:sqlite` → `sql.js`（`src/lib/db/driver.js:55-74`）。落到 `sql.js` fallback 时，**每次 `run()` 都会 debounce 100ms 后把整个数据库 dump 成 Buffer 全文件重写**：

`src/lib/db/adapters/sqljsAdapter.js` L24-39:

```js
  function persist() {
    const data = db.export();
    fs.writeFileSync(filePath, Buffer.from(data));
    dirty = false;
  }
```

   每请求一次 EWMA 更新 = 每请求一次全库重写。在无构建工具链的机器上（正是 `better-sqlite3` 进 `optionalDependencies` 要照顾的那批）这是明确的性能回退。
3. **不要从 `requestDetails` 反查历史时延来热启动。** 三个硬伤：
   - 默认**关闭**：`enableObservability: false`（`settingsRepo.js:42`），`saveRequestDetail` 直接 early-return（`requestDetailsRepo.js:143-145`）。绝大多数部署里这张表是空的。
   - **定量裁剪**：超过 `observabilityMaxRecords`（默认 1000）就按 `timestamp ASC` 删（`requestDetailsRepo.js:127-133`）。高流量下窗口可能只有几分钟。
   - **latency 藏在 JSON blob 里**：建表只有 `id, timestamp, provider, model, connectionId, status, data` 七列（`:122`），`latency.ttft` 在 `data` 里，没有索引，要全表 parse 才能聚合。
4. **dev 热重载**：Next.js dev 下模块状态每次 HMR 清零。DB 层已经用 `global._dbAdapter` 规避（`driver.js:3-5`）。EWMA store 应同样挂 `globalThis`，否则开发时永远学不到东西、也永远测不出抖动。

**多进程 / 多 isolate**：

- 本地形态是**单进程**（`custom-server.js` 无 cluster/fork，CLI 也是单实例），所以进程内状态是**准确**的，不是近似。
- 私有 fork 的 Cloudflare Worker 侧则是**每 isolate 独立**（`combo.js:329` 有 `// Worker-safe` 注释，说明这份代码确实跑在 Worker 里）。Worker 上 EWMA 会出现：样本极度稀疏（每 isolate 只见到几个请求）+ 各 isolate 独立决策 → 既学不到东西又互相打架。
- **建议**：把 stats 的读/写抽成可注入接口（默认 in-memory Map），Worker 侧注入 no-op → value 模式在 Worker 上**自动降级为静态 cost 排序**（依然有用，且完全确定）。别在 Worker 上跑 EWMA。

⚠️ **失效钩子必须与 rotation 分开。** `resetComboRotation()` 目前会在**任何** combo 设置变更时被全量调用：

`src/app/api/settings/route.js` L90-97:

```js
    if (
      Object.prototype.hasOwnProperty.call(body, "comboStrategy") ||
      Object.prototype.hasOwnProperty.call(body, "comboStickyRoundRobinLimit") ||
      Object.prototype.hasOwnProperty.call(body, "comboStrategies")
    ) {
      resetComboRotation();
    }
```

如果 EWMA 塞进同一个 Map / 同一个 reset 函数，那么**用户每微调一次 cost 就把所有学到的时延清零** —— 调参过程本身会让系统永远处于冷启动。必须是独立的 `resetComboValueStats()`，且**只在显式操作时调用**（删除 combo、用户点"重置统计"），不跟着 settings PATCH 走。

---

## 5. `softTimeout` 的风险：计费、取消、SSE

**结论：一期直接砍掉。当前架构下对流式请求不可实现，对非流式实现了也没什么用。**

### 5.1 结构上不可实现（流式）

时间线：

```
t=0     handleComboChat 进入循环 (combo.js:300)
t=0     await handleSingleModel(body, model1)          (combo.js:305)
t≈300ms 上游响应头到达 → handleStreamingResponse 返回 Response (streamingHandler.js:104)
t≈300ms result.ok === true → combo.js:310 `return result`   ← 循环已退出
t≈300ms Next 开始把 SSE 推给客户端
t=45s   第一个 token 还没来 …… 但已经没有任何代码在 combo 层等待了
```

`softTimeout 45–90s` 想在 t=45s 切到下一家 —— 但那时 `handleComboChat` 早已返回，HTTP 响应头（`SSE_HEADERS`）已经发给客户端了。**HTTP 层面无法回退**：既不能改状态码，也不能重开一条流（客户端已在读第一条）。

要实现只有两条路，都很贵：
- **(a) 缓冲整条流**：在 combo 层 hold 住 Response，攒到确认"没卡"才转发。这直接摧毁流式的全部意义（TTFT 变成 TTLT），且与 `pipeWithDisconnect`（`open-sse/utils/streamHandler.js:191`）的背压/断连/stall 检测逻辑冲突。
- **(b) 把竞速下沉到流管线**：在 `handleStreamingResponse` 内部做"首字节竞速"，第一路超时就 abort 并把第二路的流接上同一个 `TransformStream`。技术上可行，但这是**流管线的重构**，不是"combo 排序的可选功能"，风险等级完全不同 —— 而且草案自己写了"一期不做竞速"。

### 5.2 计费：双花是必然，不是风险

- 放弃的那一路若不 abort，上游**会把整个回答生成完并计费**。abort 需要 `streamController.abort()`（`utils/streamHandler.js`），但 `streamController` 建在 `chatCore.js:299`，combo 层拿不到 —— 需要把 abort 句柄一路透出来。
- `usage` 会被**双记**：`saveUsageStats` 在 `onStreamComplete` 里无条件调用（`streamingHandler.js:139`），两路各记一次 → 用量/成本统计虚高。value 排序本身要靠成本数据决策，**这会形成"越切越贵→越贵越切"的反馈**。
- 429 / 配额也被双消耗，可能把两个渠道一起打到限流。

### 5.3 账号状态污染

`open-sse/handlers/chatCore/streamingHandler.js` L47-53:

```js
  if (onRequestSuccess) {
    Promise.resolve()
      .then(onRequestSuccess)
```

`onRequestSuccess`（→ `clearAccountError`）在**流开始时**就 fire 了。被软超时放弃的那一路，其账号已经被标记为"成功、清除错误态"。等于告诉多账号 fallback 层"这个账号很健康"，而它其实刚刚卡了 90 秒。

### 5.4 与现有超时常量重复

已经有两个语义位：

`open-sse/config/runtimeConfig.js` L51-56:

```js
// Inter-chunk stall timeout (once tokens are flowing). Generous headroom so
// slow reasoning models aren't aborted mid-stream. Env: STREAM_STALL_TIMEOUT_MS.
export const STREAM_STALL_TIMEOUT_MS = envMs("STREAM_STALL_TIMEOUT_MS", 360 * 1000);

// Time-to-first-token timeout (prompt prefill). Env: STREAM_FIRST_CHUNK_TIMEOUT_MS.
export const STREAM_FIRST_CHUNK_TIMEOUT_MS = envMs("STREAM_FIRST_CHUNK_TIMEOUT_MS", 200 * 1000);
```

草案的 45–90s 落在这两者之下。再造一个平行的 `softTimeoutMs` 会出现"三个超时互相压制、谁先触发看具体 provider 配置（`stallTimeoutMs` 还能被 provider registry 覆盖，见 `providers/registry/qoder.js:23`）"的运维噩梦。**若二期真要做，应该是收紧/复用 `STREAM_FIRST_CHUNK_TIMEOUT_MS` 的语义位（per-combo 覆盖），而不是新增一个。**

### 5.5 一期的替代方案（零风险，拿到 90% 收益）

不做 in-flight 切换，只做**事后降权**：某次请求 TTFT 超过阈值 → 记一个"慢样本"（可以加权惩罚），下一个请求自然排到后面。这正是 EWMA 本来就该做的事，不需要 softTimeout 这个机制。**慢的那一次仍然慢**（用户体验上这一次没救），但第二次起就绕开了 —— 而"偶发很慢"的场景里，这已经解决了绝大部分痛点。

---

## 6. 公式批判：1/1.5/4 下的实际行为、饿死、抖动、冷启动

### 6.1 `L0` 的语义反直觉，且 8s 让 latency 几乎失效

`score = cost × (1 + t/L0)`，越低越优先。渠道 A（cost `c₁`，时延 `t₁`）何时输给渠道 B（cost `c₂`，时延 `t₂`）？

```
c₁(1 + t₁/L0) > c₂(1 + t₂/L0)
⇒ t₁ > (c₂/c₁)·(L0 + t₂) − L0
```

代入设计自己的数字（`L0 = 8s`）：

| 对比 | 成本比 | B 的时延 | A 需要慢到 | 判断 |
| --- | --- | --- | --- | --- |
| 渠道1 vs 渠道2 | 1.5× | 8s | **> 16s** | 合理 |
| 渠道1 vs 渠道3 | 4× | 8s | **> 56s** | 太钝 |
| 渠道1 vs 渠道3 | 4× | 5s | **> 44s** | 太钝 |
| 渠道2 vs 渠道3 | 2.67× | 8s | **> 34.7s** | 偏钝 |

所以在 `L0=8s` 下，这个公式**几乎是纯成本排序**：贵 4 倍的稳定渠道要等便宜渠道慢到接近一分钟才会被启用。

对照设计自己的验收标准：
- 「1慢→2→1→3 不抖」✅ 能过（1 慢到 >16s 就让给 2，符合预期）。
- 「1+2差→3」⚠️ 要求 1 和 2 **同时**慢到 35–56 秒。而"偶发很慢但不挂"通常是 10–40s 量级 —— **这条验收在 L0=8s 下大概率不成立**，功能会给人"配了但没用"的观感。

更大的问题是**调参方向反直觉**：`L0` 的名字和"≈8s（典型 TTFT）"的描述会让人以为它是"基准时延"，于是当"切换不够积极"时，运维的第一反应是**调大 L0**（"我们的正常时延比 8s 高"）—— 而调大 L0 会让 latency 项**更不重要**，切换更加不积极。这是一个会反复咬人的运维陷阱。

### 6.2 建议：改成量纲显式的线性形式

```
score = costPerCall + latencyWeightPerSec × latencySec
```

- 两项**同量纲**（都是"钱"），可解释：`latencyWeightPerSec = 0.02` 就是"我愿意为省 1 秒多付 $0.02"。
- 调参方向符合直觉：想更激进地避开慢渠道 → 调大 `latencyWeightPerSec`。
- 与业务对话直接：产品/老板问"为什么走了贵的"，答案是"因为你把一秒定价成 2 分钱，而便宜那家慢了 30 秒 = $0.6，比差价贵"。
- 若坚持乘性形式（有它的好处：对 cost 尺度不敏感，无需知道绝对客单价），**至少把 `L0` 改名成能反映语义的名字**（例如 `latencyPricingRefMs`），并在文档写清「**L0 越大 = 越不在乎时延**」。这一句注释能省掉未来无数次误调。

### 6.3 成功率完全没进公式

设计开篇说「性能 = 耗时/成功率」，但公式里**没有任何失败项**。而"硬错误立刻下一家"意味着一个 30% 失败率的渠道每次都要先浪费一次往返（可能还有 `combo.js:345-349` 的 503 冷却等待 0–5s），并且**已经产生了 prefill 计费**（很多上游对失败前的 prefill 仍然计费）。

**MUST-FIX**：要么把失败率纳入打分，要么把「成功率」从设计描述里删掉（避免文档承诺没实现的东西）。最简形式：

```
effectiveLatency = ewmaMs + failRate × retryPenaltyMs
```

其中 `retryPenaltyMs` 可以直接用"下一家的 EWMA"来近似（失败的代价就是要重跑一遍）。`failRate` 从同一批样本里统计，零额外成本 —— `recordSample` 已经要传 `ok` 了。

### 6.4 冷启动与饿死：这是最容易让功能"看起来没坏但学不到东西"的坑

**串行 fallback 的根本性采样偏差**：只有排第一的成员会被调用；第 2、3 名只在第 1 名**硬失败**时才拿到流量。而"偶发很慢但不挂"的定义就是**不会硬失败**。所以：

- 第 2、3 名的样本数长期为 0 → `minSamples: 5` 永远不满足 → 永远走"默认序" → **永远无法被提升**。
- 反过来更糟：某次事故给渠道 1 留了一个 60s 的坏样本，它掉到第 2 位后**不再接到流量** → 没有新样本 → EWMA **不会衰减**（EWMA 只在有新样本时更新）→ 渠道 1 被**永久钉死**在第 2 位。设计里「慢请求临时惩罚衰减」提到了这个方向，但如果实现成"按样本更新"而不是"按时间衰减"，就治不了。

**MUST-FIX，两件都要**：

1. **按时间衰减，而非按样本衰减**。读取时按 `now - lastAt` 计算：`effective = neutral + (ewma - neutral) × 2^(-(now-lastAt)/halfLife)`，并设 `staleAfterMs`（例如 30min）之后直接视为"无样本"。这样坏样本会自动过期，渠道自动获得复活机会。这也顺便实现了「恢复后滞后回 1」这条验收。
2. **少量强制探索**。例如 5% 的请求跳过 value 排序、直接用默认序（或把当前第 2 名提到第 1）。没有探索，串行架构下 EWMA 在数学上就是个只会单调恶化的排行榜。

⚠️ 探索有个隐藏成本要写进设计：探索请求可能命中**更贵**的渠道，也会**打断 prompt cache**（见 6.5）。所以探索比例要小，并且**优先在会话开始时探索**，而不是会话中途。

### 6.5 公式忽略了 prompt cache 亲和性 —— 可能让"省钱"变成"花钱"

这是本评审认为**最被低估**的风险。

看 Claude Opus 的实际价格（`open-sse/providers/pricing.js:25`）：

```
"claude-opus-4.6": { input: 5.00, output: 25.00, cached: 0.50, reasoning: 37.50, cache_creation: 5.00 }
```

`cached` 是 `input` 的 **1/10**。在 agent/coding 场景里，多轮会话的 prompt 前缀（system + 工具定义 + 历史）是主要 token 来源，缓存命中与否可以造成**整体成本 5–10 倍**的差异。

而 prompt cache 是**per-渠道/per-账号**的。value 排序在 t 时刻把会话从渠道 1 切到渠道 2：
- 渠道 2 冷缓存 → 全量 `cache_creation`（`$5.00/1M`，Anthropic 的 5 分钟 TTL 还要续期）
- 渠道 1 的缓存开始过期
- 15 分钟半衰期的 EWMA 判定渠道 1 恢复了 → 切回去 → 渠道 1 缓存已过期 → **又是一次全量 cache_creation**

**在多轮会话里，一次渠道切换的缓存重建成本，可能超过这个功能想省下的全部差价。** 而公式（只有 cost 常数 × 时延）对此完全无感知。

**MUST-FIX：按会话粘滞（session stickiness），而不是按请求重排。**

好消息是基础设施已经有了：`open-sse/utils/sessionManager.js:219` 的 `resolveSessionId({ headers, body, connectionId, scope })`，`chatCore.js:66` 已经在用它做日志着色。建议：

- value 排序的结果**按 session 缓存**，一个会话内锁定成员顺序。
- 只在（a）会话首个请求、（b）当前 leader 硬失败、（c）leader 的 EWMA 劣化超过滞后阈值**且**超过一个最小锁定时长（例如 ≥ cache TTL）时才重排。
- 这同时也**顺手解决了抖动问题** —— 比 15% 滞后更本质，因为抖动的真实代价主要就是缓存失效，而不是"排序看起来不稳定"。

### 6.6 滞后（hysteresis）的实现细节

「15% 滞后」在**两个**成员上定义清楚，在**三个以上**成员的全序上会不传递（A 不足以超过 B、B 不足以超过 C，但 A 足以超过 C → 排序结果依赖比较顺序，且 `Array.prototype.sort` 的 comparator 若不满足传递性，V8 的行为是**未定义**的）。

**建议实现成 leader-lock 而非全局滞后**：
1. 记住当前 leader；
2. 挑战者只有在 `score(challenger) < score(leader) × (1 − hysteresisRatio)` 时才换 leader；
3. 其余成员按 raw score 正常排序（无滞后）。

这样滞后只作用在"谁排第一"这个唯一真正影响行为的决策上，comparator 保持严格弱序，可预测、可单测。

---

## 7. 安全 / 运维 footguns

1. **comparator 返回 `NaN` 会破坏 fallback 顺序（严重）。**
   `/api/settings` 的 PATCH 是**近乎裸的 mass-assign**：只剥离 `PROTECTED_SETTING_KEYS`，其余整个 body 直接 `updateSettings(body)`（`src/app/api/settings/route.js:38-79`），**没有任何数值校验**。所以 `memberCost: { "cc/opus": "很便宜" }` 或 `null` / `-1` / `1e309` 都能落库。
   若 `score()` 返回 `NaN`，`sort` 的 comparator 恒返回 `NaN`（既非 `<0` 也非 `>0`），V8 会给出**任意顺序** —— 后果不是"路由不够优"，而是**可能把唯一有可用凭据的成员排到最后**，把一个正常 combo 变成"每次都要先失败 2 次"。
   **必须**像既有的 `normalizeStickyLimit` 一样在读取侧 clamp：

`open-sse/services/combo.js` L186-189:

```js
function normalizeStickyLimit(stickyLimit) {
  const parsed = Number.parseInt(stickyLimit, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}
```

   同样的模式套到 `memberCost`（`Number.isFinite && > 0`，否则回落到 pricing 表或 1）和所有 `valueTuning` 数值。并且**排序函数本身要保证永不返回 `NaN`**（最后一道防线：`(a - b) || 0`）。

2. **`memberCost` 是纯用户输入，且没有 schema 边界。** 建议在 `/api/settings` 加一个 `comboStrategies` 的轻量白名单校验（只接受已知键、数值型键做 clamp、字符串键长度上限）。目前 `comboStrategies` 可以被写成任意深度的任意 JSON 并全量序列化进 `settings.data` 单行 —— 已经是个（低危但真实的）无界写入面。

3. **样本 Map 的无界增长 / key 生命周期。** rotation Map 用 `comboName` 做 key 且有显式 reset（`combo.js:243-246`，被 `src/app/api/combos/[id]/route.js:53-74` 调用）。EWMA 的 key 是 `provider/model`（比 combo 名更稳定，好事），但成员被移除、模型下线、provider 删除后条目会残留。建议加**条目数上限 + LRU 淘汰**，或按 `staleAfterMs` 定期清理（反正陈旧样本本来就要作废，两件事可以合并）。

4. **别把成本/时延统计暴露成无鉴权端点。** 若要做诊断 API（例如 `/api/combos/[id]/stats`），必须走 dashboard 现有的鉴权中间件。渠道成本对照表 + 各渠道时延画像属于运营敏感信息（能反推出用了哪些转售商、单价多少）。

5. **日志噪声与信息泄露。** `combo.js` 现有的 `log.info("COMBO", ...)` 每请求一行。若再加"score 明细"每请求一行，高 QPS 下 `~/.9router/log.txt` 会显著膨胀（且 usage/log 不遵循 `DATA_DIR`，见 `CLAUDE.md`）。建议：只在**排序结果实际发生变化**时打一行（照抄现有 `if (reordered[0] !== rotatedModels[0])` 的门槛，`combo.js:289`），明细走 `log.debug`。另外日志里不要打成本绝对值。

6. **`combo.js:345-349` 的 503 冷却等待会污染样本**（最多 5s，被算进"这次请求耗时"）。若采集总耗时必须扣除；采集 TTFT 则天然不受影响 —— 又一个选 TTFT 的理由。

7. **UI 静默清配置**（见 §3 的两段代码引用）。属于安全性范畴的"数据丢失"类 footgun，且其中 media 页面那处是**既有 bug**，加了 `memberCost` 之后后果放大。

8. **`resetComboRotation()` 误伤**（见 §4 末）。改一次 cost 清空全部学习状态。

---

## 8. MUST-FIX（实现前必须解决） vs Nice-to-have

### MUST-FIX

| # | 问题 | 位置 / 依据 |
| --- | --- | --- |
| 1 | EWMA 写入点必须在流收尾（`onStreamComplete` 等三处），**不能**在 combo 层计时 —— 否则流式请求量到的是响应头时延，学不到"body 慢" | `streamingHandler.js:104-107`, `113-141` |
| 2 | 一期**移除 `softTimeout`**（或明确降级为"事后降权"）。当前架构下流式不可回退，双花/双记 usage/双清账号错误态全部必然发生 | `streamingHandler.js:47-53`, `139`；`combo.js:305-310` |
| 3 | `models[]` **保持字符串数组**；cost 放 `settings.comboStrategies[name].memberCost` | `combosRepo.js:11,48`；`capacityAdapter.js:95-99,160-172`；`cli/src/cli/menus/combos.js` |
| 4 | 排序顺序：**value 先、`reorderByCapabilities` 后**；capacity-adapter 前插的模型必须排除在 value 排序之外 | `combo.js:63-82`；`capacityAdapter.js:92-100`；`chat.js:99-100` |
| 5 | 打分/排序对非法输入必须 clamp，comparator **永不返回 `NaN`**（否则可能把唯一可用成员排到最后） | `src/app/api/settings/route.js:38-79`；参照 `combo.js:186-189` |
| 6 | 用 `fallbackStrategy: "value"`（第四种取值），**不要**正交的 `routingMode`；且**禁止**全局 `settings.comboStrategy = "value"` | `chat.js:96-98` 等 5 处 |
| 7 | 修两个会静默吞掉 `memberCost` 的 UI 写入路径（一处是既有 bug） | `dashboard/combos/page.js:164-173`；`media-providers/combo/[id]/page.js:156-158` |
| 8 | 冷启动/饿死双治：**按时间衰减 + `staleAfterMs` 回归中性**，加**少量强制探索**。否则串行 fallback 下第 2/3 名永远拿不到样本、坏样本永久钉住 | `combo.js:300-361`（串行结构） |
| 9 | **按 session 粘滞排序**，保护 prompt cache（`cached` 仅为 `input` 的 1/10，切换会重付 `cache_creation`）；同时这比 15% 滞后更本质地解决抖动 | `pricing.js:25`；`utils/sessionManager.js:219`（`chatCore.js:66` 已在用） |
| 10 | value 分支只在 chat 路径 opt-in 生效，不要影响 search/fetch/tts/image 四个共用调用方 | `src/sse/handlers/{search,fetch,imageGeneration,tts}.js` |
| 11 | 成功率要么进公式，要么从设计描述里删掉「性能=耗时/成功率」 | 设计文本 vs 公式 |
| 12 | 独立 `resetComboValueStats()`，不要挂在 `resetComboRotation()` 上（否则调参即清零） | `src/app/api/settings/route.js:90-97` |

### Nice-to-have

- `memberCost` 缺省从 `getPricingForModel()` 推导，手填仅作 override（`pricing.js:368`）。**但订阅/OAuth 渠道边际成本≈0，手填能力必须保留。**
- 公式改成量纲显式的线性形式 `costPerCall + latencyWeightPerSec × latencySec`；若保留乘性，至少给 `L0` 改个能反映"时间的价格"的名字并写明调参方向。
- 只采集流式样本，或按 `stream` 分桶（非流式 `ttft === total`，不可比）。
- 二期：把总耗时归一化为 **ms/output_token**（`onStreamComplete` 的 `usage` 里就有 `completion_tokens`，零成本）。
- hysteresis 实现成 **leader-lock** 而非全局 15%（三成员以上全局滞后不传递，comparator 行为未定义）。
- Worker/isolate 侧注入 no-op stats → value 自动降级为静态 cost 排序。
- EWMA store 挂 `globalThis`（照抄 `driver.js:3-5` 抗 dev HMR 的做法）。
- 样本 Map 加条目上限 / LRU（可与 `staleAfterMs` 清理合并）。
- 只在排序结果实际变化时打 info 日志（照抄 `combo.js:289` 的门槛），明细走 debug。
- 一个 `buildMemberKey(provider, model)` 工具 + 单测，防止带斜杠的上游 model id（`pricing.js:158` 那种 `anthropic/claude-opus-4.6`）导致 key 错位、样本永远匹配不上。
- 可选的诊断视图（各成员 EWMA / 样本数 / 当前分数 / 上次被选原因），走 dashboard 鉴权。运维排查"为什么走了贵的"没有这个基本没法查。

---

## 9. 字段命名建议（与本仓库既有约定一致）

本仓库约定：ESM + 纯 JS、**camelCase**、时间量一律 `...Ms` 后缀（`stragglerGraceMs` / `panelHardTimeoutMs`（`combo.js:472-476`）、`pxpipeTimeoutMs` / `observabilityFlushIntervalMs`（`settingsRepo.js`））、per-combo 的嵌套调参袋叫 `<feature>Tuning`（`fusionTuning`，`chat.js:118`）。

```jsonc
// settings.comboStrategies["<comboName>"]
{
  "fallbackStrategy": "value",          // 第四种取值，与 fallback/round-robin/fusion 并列

  "memberCost": {                       // 相对成本 override；key = models[] 里的原始字符串
    "cc/claude-opus-4.6": 0,            // 订阅渠道：边际成本 ≈ 0
    "tokenrouter/anthropic/claude-opus-4.6": 1.5,
    "anthropic/claude-opus-4-6": 4
  },

  "valueTuning": {
    "latencyWeightPerSec": 0.02,        // 建议的线性形式：每省 1 秒愿意多付多少（与 cost 同量纲）
    "ewmaHalfLifeMs": 600000,           // 10min，落在设计的 5–15min 区间
    "hysteresisRatio": 0.15,            // leader-lock 阈值
    "minSamples": 5,
    "staleAfterMs": 1800000,            // 超过则视为无样本（治"坏样本永久钉住"）
    "explorationRatio": 0.05,           // 强制探索比例（治"第2/3名拿不到样本"）
    "stickyBySession": true,            // 会话内锁定顺序（护 prompt cache）
    "minLeaderHoldMs": 300000           // leader 最短锁定时长，建议 ≥ prompt cache TTL
  }
}
```

命名说明：

| 草案 | 建议 | 理由 |
| --- | --- | --- |
| `routingMode: static\|value` | `fallbackStrategy: "value"` | 复用既有单值分支，省 5 个调用点改动；旧 combo 无此值 → 天然默认关 |
| `member cost` | `memberCost`（map，key = `models[]` 原字符串） | 不动 `models[]` schema；与 `judgeModel`/`fusionTuning` 同层 |
| `L0` | `latencyWeightPerSec`（线性）或 `latencyPricingRefMs`（乘性） | `L0` 非 camelCase、无单位后缀、且语义会被误读成"典型时延" |
| `ewmaHalfLife` | `ewmaHalfLifeMs` | `...Ms` 是全仓约定 |
| `hysteresis` | `hysteresisRatio` | 明示是比例不是绝对值 |
| `softTimeoutMs` | （一期删除）二期考虑 per-combo 覆盖 `STREAM_FIRST_CHUNK_TIMEOUT_MS` | 避免第三个平行超时（`runtimeConfig.js:53,56` + provider 级 `stallTimeoutMs` 覆盖） |
| `latencyWeight`（可选项） | 升为主参数 | 见 §6.2 |
| —— | `staleAfterMs` / `explorationRatio` / `stickyBySession` / `minLeaderHoldMs` | 草案缺失，但是 MUST-FIX 8/9 的落点 |

新增 key 需同步进 `DEFAULT_SETTINGS`（`src/lib/db/repos/settingsRepo.js:17-19` 附近），并保持 `comboStrategies: {}` 默认为空 —— 这就是"默认关"的机制保证。

建议的模块与导出（与既有测试范式对齐）：

```
open-sse/services/comboValueStats.js     // recordSample / getStats / resetComboValueStats
open-sse/services/combo.js               // 新增导出 reorderByValue(models, opts) —— 纯函数
```

`reorderByValue` 应当是**纯函数**（`now` 与 `stats` 从参数注入，不读全局时钟/全局 Map），理由：`tests/unit/combo-routing.test.js` 和 `combo-autoswitch.test.js` 正是这个范式（直接 import `getRotatedModels` / `reorderByCapabilities` 做纯函数断言，无网络、无 DB）。注入 `now` 才能不靠 fake timer 测出衰减和滞后。

---

## 10. 验收清单：草案的 7 条 + 建议补的 6 条

草案的 7 条（正常 1→2→3 / 1慢→2→1→3 不抖 / 1+2差→3 / 恢复滞后回1 / 401、429 立刻切 / 关 value = 现网）方向正确，但**都是端到端行为断言**，在当前测试设施下不好自动化（`scripts/test-combo-autoswitch.mjs` 是需要真实凭据的 live 脚本）。建议**把它们下沉成 `reorderByValue` 的纯函数单测**（喂构造好的 stats + 注入 now），live 脚本只做冒烟。

补充这 6 条（每条对应一个上面识别出的具体风险）：

1. **流式路径真的记到了 TTFT**：一个流式请求跑完后，stats 里的样本值应接近 `📊 DONE` 日志行里的 `TTFT`，而**不是**接近响应头时延。—— 直接验证 MUST-FIX 1 是否真的做对了。
2. **能力优先级不被 value 覆盖**：给一个含图请求，成员里最便宜的不支持 vision → 最终必须走支持 vision 的成员。（对应 MUST-FIX 4）
3. **capacity-adapter 模型不参与 value 排序**：无成员满足硬能力时，adapter 前插的模型仍在首位。（对应 MUST-FIX 4）
4. **脏配置不破坏 fallback 顺序**：`memberCost` 填 `"abc"` / `null` / `-1` / `NaN`，排序结果必须仍是一个确定的全序，且不把可用成员排到最后。（对应 MUST-FIX 5）
5. **prompt cache / 会话粘滞**：同一 session 的连续多轮请求不应在渠道间跳动；并观测 `cache_creation_input_tokens` 没有因重排而反复产生。（对应 MUST-FIX 9 —— 这是"省钱功能反而花钱"的唯一防线）
6. **关掉 value 与现网等价**：不靠肉眼比对。用 `tests/__baseline__/verify-no-regression.mjs` 判断是否回归（按 `CLAUDE.md`：本仓库测试**不预期全绿**，约 938 pass / 64 fail，其中 26 条在 `known-fails.txt`），另加一条"value 未配置时 `handleComboChat` 的 `models` 顺序与入参严格 `toEqual`"的单测。

另外建议加一条**负向**验收：**第 2、3 名在长期无硬失败的情况下，样本数不应长期为 0** —— 如果为 0，说明探索机制没生效，整个 EWMA 是个只会单调恶化的排行榜（§6.4）。这条最容易在实现后被忽略，而它一旦失效，功能就变成了"上线三天后所有 combo 都退化成固定顺序"。

---

## 附：一句话总评

**这不是一个"只改 combo.js 的排序注入"，而是一个"跨 `open-sse/handlers` 与 `open-sse/services` 边界的观测 + 决策双端改动"。** 认清这一点（并砍掉 `softTimeout`、把 EWMA 写入点放到流收尾、按 session 粘滞护住 prompt cache、给冷启动加时间衰减和探索）之后，它是一个**风险可控、默认关、可回退**的好功能。反之，若按草案字面实现，最可能的结局是：功能上线、日志里能看到重排、但（a）流式请求学到的是响应头时延而非真正的慢，（b）第 2/3 名永远没有样本，（c）多轮会话因缓存反复重建而总成本上升 —— 三个都是"不报错、不告警、只是没用甚至更贵"的失败模式。
