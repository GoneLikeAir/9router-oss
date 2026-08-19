const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const DASH_IMAGE_ERR = "Images must be PNG, JPEG, or WebP, max 20 MB.";
const MAX_BYTES = 20 * 1024 * 1024;
const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function imageInputToUrl(input) {
  if (/^(https?:|data:)/i.test(input)) return input;
  const ext = path.extname(input).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) throw new Error(DASH_IMAGE_ERR);
  const buf = fs.readFileSync(input);
  if (buf.length > MAX_BYTES) throw new Error(DASH_IMAGE_ERR);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function downloadToBuffer(url, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const get = (target, redirectsLeft) => {
      const mod = target.startsWith("https:") ? https : http;
      const req = mod.get(target, { signal }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          return get(new URL(res.headers.location, target).toString(), redirectsLeft - 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      });
      req.on("error", reject);
    };
    get(url, 5);
  });
}

module.exports = { imageInputToUrl, DASH_IMAGE_ERR, downloadToBuffer };
