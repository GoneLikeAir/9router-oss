import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { run, parseArgs } = require("../../cli/src/cli/commands/xaiImage.js");
const { imageInputToUrl } = require("../../cli/src/cli/commands/xaiMediaShared.js");

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}
const closeServer = (server) => new Promise((r) => server.close(r));

let tmpDir;
let server;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xai-image-test-"));
});

afterEach(async () => {
  if (server) {
    await closeServer(server);
    server = null;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("parseArgs", () => {
  it("defaults output to image.png", () => {
    const opts = parseArgs(["--prompt", "hi"]);
    expect(opts.output).toBe("image.png");
    expect(opts.model).toBe("xai/grok-imagine-image");
  });

  it("collects repeated --image and --file-id", () => {
    const opts = parseArgs([
      "--prompt", "p",
      "--image", "a.png",
      "--image", "b.png",
      "--file-id", "file_abc",
    ]);
    expect(opts.images).toEqual(["a.png", "b.png"]);
    expect(opts.fileIds).toEqual(["file_abc"]);
  });

  it("rejects unknown flags", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(/Unknown option/);
  });
});

describe("imageInputToUrl", () => {
  it("rejects a local path with no image extension", () => {
    const p = path.join(tmpDir, "noext");
    fs.writeFileSync(p, Buffer.from("xx"));
    expect(() => imageInputToUrl(p)).toThrow(/PNG, JPEG, or WebP/);
  });

  it("rejects gif and unknown extensions", () => {
    const gif = path.join(tmpDir, "x.gif");
    fs.writeFileSync(gif, Buffer.from("GIF"));
    expect(() => imageInputToUrl(gif)).toThrow(/PNG, JPEG, or WebP/);
  });

  it("encodes a png", () => {
    const p = path.join(tmpDir, "in.png");
    fs.writeFileSync(p, Buffer.from([1, 2, 3]));
    expect(imageInputToUrl(p)).toBe(`data:image/png;base64,${Buffer.from([1, 2, 3]).toString("base64")}`);
  });
});

describe("run", () => {
  it("warns and ignores --quality on non-2.0 models", async () => {
    const err = [];
    const orig = console.error;
    console.error = (m) => err.push(String(m));
    const code = await run([
      "--prompt", "x",
      "--quality", "low",
      "--model", "xai/grok-imagine-image",
      "--host", "127.0.0.1",
      "--port", "1",
    ]);
    console.error = orig;
    expect(code).toBe(1);
    expect(err.some((l) => l.includes("Quality is only sent for grok-imagine-image-2.0"))).toBe(true);
  });

  it("rejects more than 3 combined refs without calling the gateway", async () => {
    const code = await run([
      "--prompt", "x",
      "--image", "https://a",
      "--image", "https://b",
      "--image", "https://c",
      "--file-id", "file_d",
    ]);
    expect(code).toBe(1);
  });

  it("POSTs edits JSON and writes the file", async () => {
    const png = Buffer.from([137, 80, 78, 71]);
    const started = await startServer((req, res) => {
      if (req.method === "POST" && req.url === "/v1/images/edits") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const parsed = JSON.parse(body);
          expect(parsed.image.url).toBe("https://example.com/a.png");
          expect(parsed.response_format).toBe("b64_json");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }));
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server = started.server;
    const out = path.join(tmpDir, "out.png");
    const code = await run([
      "--prompt", "sketch",
      "--image", "https://example.com/a.png",
      "--output", out,
      "--port", String(started.port),
    ]);
    expect(code).toBe(0);
    expect(fs.readFileSync(out)).toEqual(png);
  });

  it("downloads a url fallback over http(s) when b64 is absent", async () => {
    const png = Buffer.from([137, 80, 78, 71, 9]);
    const started = await startServer((req, res) => {
      if (req.method === "POST" && req.url === "/v1/images/generations") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ url: `http://127.0.0.1:${started.port}/cdn.png` }] }));
        return;
      }
      if (req.method === "GET" && req.url === "/cdn.png") {
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(png);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server = started.server;
    const out = path.join(tmpDir, "from-url.png");
    const code = await run([
      "--prompt", "sky",
      "--output", out,
      "--port", String(started.port),
    ]);
    expect(code).toBe(0);
    expect(fs.readFileSync(out)).toEqual(png);
  });
});
