// Serves the app and saves review decisions to data/reviews.json.
// No dependencies. The page also works without this server (as plain static
// files), in which case reviews are kept in the browser instead.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { REVIEWS, ROOT, readJSON, writeJSON } from "./lib/store.js";

const PORT = Number(process.env.PORT) || 4318;
const APP = path.join(ROOT, "app");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".pdf": "application/pdf",
  ".svg": "image/svg+xml",
};

const send = (res, status, body, type = "application/json; charset=utf-8") => {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/api/reviews" && req.method === "GET") {
    return send(res, 200, readJSON(REVIEWS, {}));
  }

  const match = url.pathname.match(/^\/api\/reviews\/([\w-]+)$/);
  if (match && req.method === "PUT") {
    if (!/^application\/json/.test(req.headers["content-type"] ?? "")) return send(res, 415, { error: "JSON only" });
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      try {
        const reviews = readJSON(REVIEWS, {});
        reviews[match[1]] = JSON.parse(body);
        writeJSON(REVIEWS, reviews);
        send(res, 200, { ok: true });
      } catch (err) {
        send(res, 400, { error: String(err.message) });
      }
    });
    return;
  }

  if (url.pathname.startsWith("/api/")) return send(res, 404, { error: "Not found" });

  // Static files, kept inside app/.
  const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const file = path.join(APP, rel);
  if (!file.startsWith(APP + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(res, 404, "Not found", "text/plain");
  }
  send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] ?? "application/octet-stream");
});

server.listen(PORT, "127.0.0.1", () => console.log(`Mill Cert Checker: http://localhost:${PORT}`));
