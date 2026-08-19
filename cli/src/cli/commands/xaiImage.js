/**
 * `9router xai image` — generate or edit a Grok Imagine image through the
 * local 9router gateway. JSON only (never multipart).
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { imageInputToUrl, downloadToBuffer } = require("./xaiMediaShared");

const DEFAULT_PORT = 20128;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_MODEL = "xai/grok-imagine-image";
const DEFAULT_TIMEOUT_SEC = 180;
const MAX_REFS = 3;

const HELP = `
Usage: 9router xai image --prompt "..." [options]

Generate or edit a Grok Imagine image via your local 9router gateway
(requires Grok CLI (Grok Build) login or an xAI API key).

The gateway call is JSON, not multipart. --image may be repeated up to 3 times.

Options:
  --prompt <text>         Image description (required)
  --output <file>         Output path (default: image.png)
  --model <id>            Model (default: ${DEFAULT_MODEL})
  --image <path-or-url>   Reference image (repeatable, max 3 with --file-id)
  --file-id <id>          xAI Files file_id (repeatable, counts toward 3)
  --aspect-ratio <ratio>  e.g. auto, 16:9, 1:1
  --resolution <res>      1k | 2k
  --quality <q>           low | medium (sent only for grok-imagine-image-2.0)
  --n <count>             Number of images
  --timeout <seconds>     Request timeout (default: ${DEFAULT_TIMEOUT_SEC})
  --port <port>           Gateway port (default: ${DEFAULT_PORT})
  --host <host>           Gateway host (default: ${DEFAULT_HOST})
  --api-key <key>         9router API key (or env NINE_ROUTER_API_KEY)
  -h, --help              Show this help
`;

function sanitizeText(text) {
  return String(text ?? "").replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]");
}

function parseArgs(argv) {
  const opts = {
    model: DEFAULT_MODEL,
    output: "image.png",
    timeoutSec: DEFAULT_TIMEOUT_SEC,
    port: DEFAULT_PORT,
    host: DEFAULT_HOST,
    apiKey: process.env.NINE_ROUTER_API_KEY || null,
    images: [],
    fileIds: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--prompt") opts.prompt = next();
    else if (a === "--output" || a === "-o") opts.output = next();
    else if (a === "--model") opts.model = next();
    else if (a === "--image") opts.images.push(next());
    else if (a === "--file-id") opts.fileIds.push(next());
    else if (a === "--aspect-ratio") opts.aspectRatio = next();
    else if (a === "--resolution") opts.resolution = next();
    else if (a === "--quality") opts.quality = next();
    else if (a === "--n") opts.n = parseInt(next(), 10);
    else if (a === "--timeout") opts.timeoutSec = parseInt(next(), 10) || DEFAULT_TIMEOUT_SEC;
    else if (a === "--port" || a === "-p") opts.port = parseInt(next(), 10) || DEFAULT_PORT;
    else if (a === "--host" || a === "-H") opts.host = next() || DEFAULT_HOST;
    else if (a === "--api-key") opts.apiKey = next();
    else if (a === "-h" || a === "--help") opts.help = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  return opts;
}

function gatewayRequest({ host, port, apiKey, method, reqPath, body, signal }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { Accept: "application/json" };
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const req = http.request({ hostname: host, port, path: reqPath, method, headers, signal }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const rawBuf = Buffer.concat(chunks);
        const ctype = res.headers["content-type"] || "";
        let parsed = null;
        if (ctype.includes("application/json")) {
          try { parsed = JSON.parse(rawBuf.toString("utf8")); } catch { /* keep raw */ }
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: rawBuf });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function modelId(model) {
  return String(model || "").includes("/") ? String(model).split("/").pop() : String(model || "");
}

function writeAtomic(filePath, buf) {
  const dir = path.dirname(filePath);
  const part = `${filePath}.part`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(part, buf);
  fs.renameSync(part, filePath);
}

async function run(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    return 1;
  }
  if (opts.help || !opts.prompt) {
    console.log(HELP);
    return opts.help ? 0 : 1;
  }

  const totalRefs = opts.images.length + opts.fileIds.length;
  if (totalRefs > MAX_REFS) {
    console.error("❌ Grok Imagine accepts at most 3 reference images.");
    return 1;
  }

  if (opts.quality && modelId(opts.model) !== "grok-imagine-image-2.0") {
    console.error("Quality is only sent for grok-imagine-image-2.0. Ignoring --quality.");
    opts.quality = undefined;
  }

  const refs = [];
  try {
    for (const img of opts.images) refs.push({ url: imageInputToUrl(img), type: "image_url" });
  } catch (err) {
    console.error(`❌ ${err.message}`);
    return 1;
  }
  for (const id of opts.fileIds) refs.push({ file_id: id });

  const body = { model: opts.model, prompt: opts.prompt, response_format: "b64_json" };
  if (opts.n) body.n = opts.n;
  if (opts.aspectRatio) body.aspect_ratio = opts.aspectRatio;
  if (opts.resolution) body.resolution = opts.resolution;
  if (opts.quality) body.quality = opts.quality;
  if (refs.length === 1) body.image = refs[0];
  else if (refs.length > 1) body.images = refs;

  const reqPath = refs.length ? "/v1/images/edits" : "/v1/images/generations";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutSec * 1000);

  try {
    const res = await gatewayRequest({
      host: opts.host,
      port: opts.port,
      apiKey: opts.apiKey,
      method: "POST",
      reqPath,
      body,
      signal: controller.signal,
    });
    if (res.status !== 200) {
      const detail = res.body?.error?.message || res.body?.error || res.raw?.toString?.()?.slice(0, 400) || `HTTP ${res.status}`;
      console.error(`❌ ${sanitizeText(typeof detail === "string" ? detail : JSON.stringify(detail))}`);
      return 1;
    }

    let buf = null;
    const ctype = res.headers["content-type"] || "";
    if (ctype.startsWith("image/")) {
      buf = res.raw;
    } else {
      const first = res.body?.data?.[0];
      if (first?.b64_json) buf = Buffer.from(first.b64_json, "base64");
      else if (first?.url) {
        buf = await downloadToBuffer(first.url, { signal: controller.signal });
      }
    }
    if (!buf?.length) {
      console.error("❌ No image bytes in the response");
      return 1;
    }
    writeAtomic(opts.output, buf);
    console.log(`✅ Saved ${opts.output}`);
    return 0;
  } catch (err) {
    console.error(`❌ ${sanitizeText(err?.message || String(err))}`);
    return 1;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { run, parseArgs, sanitizeText };
