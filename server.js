import { realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

const links = new Map();
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const PUBLIC_DIR = process.env.PUBLIC_DIR
  ? resolve(process.env.PUBLIC_DIR)
  : null;
const BASE_URL = getBaseUrl();
const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function getBaseUrl() {
  const explicit = process.env.BASE_URL?.trim();
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  const configured = explicit
    ? explicit
    : railwayDomain
      ? railwayDomain.includes("://")
        ? railwayDomain
        : `https://${railwayDomain}`
      : `http://localhost:${PORT}`;
  const parsed = new URL(configured);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("BASE_URL must use http or https");
  }
  return parsed.origin;
}

function makeCode() {
  let code;
  do {
    let result = "";
    while (result.length < 6) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      for (const byte of bytes) {
        if (byte < 248) result += alphabet[byte % alphabet.length];
        if (result.length === 6) break;
      }
    }
    code = result;
  } while (links.has(code));
  return code;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function staticPath(pathname) {
  if (!PUBLIC_DIR) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relativePath = decoded === "/" ? "index.html" : decoded.replace(/^[/\\]+/, "");
  const filePath = resolve(PUBLIC_DIR, relativePath);
  const fromRoot = relative(PUBLIC_DIR, filePath);
  if (
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    return null;
  }
  return filePath;
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

async function serveStatic(pathname) {
  const filePath = staticPath(pathname);
  if (!filePath) return null;
  const file = Bun.file(filePath);
  if (!(await file.exists())) return null;
  const [publicPath, actualPath] = await Promise.all([
    realpath(PUBLIC_DIR),
    realpath(filePath),
  ]);
  const actualRelativePath = relative(publicPath, actualPath);
  if (
    actualRelativePath === ".." ||
    actualRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(actualRelativePath)
  ) {
    return null;
  }
  return new Response(file, {
    headers: {
      "Content-Type":
        file.type ||
        contentTypes[extname(filePath).toLowerCase()] ||
        "application/octet-stream",
    },
  });
}

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

Bun.serve({
  port: PORT,
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/links") {
      let body;
      try {
        body = await request.json();
      } catch {
        return withCors(json({ error: "Request body must be valid JSON" }, 400));
      }
      if (typeof body?.url !== "string") {
        return withCors(json({ error: "url must be an HTTP(S) URL" }, 400));
      }
      let originalUrl;
      try {
        originalUrl = new URL(body.url);
      } catch {
        return withCors(json({ error: "url must be an HTTP(S) URL" }, 400));
      }
      if (originalUrl.protocol !== "http:" && originalUrl.protocol !== "https:") {
        return withCors(json({ error: "url must be an HTTP(S) URL" }, 400));
      }
      const code = makeCode();
      const link = {
        code,
        url: body.url,
        shortUrl: `${BASE_URL}/${code}`,
        hits: 0,
        createdAt: new Date().toISOString(),
      };
      links.set(link.code, link);
      return withCors(json(link, 201));
    }

    if (request.method === "GET" && url.pathname === "/api/links") {
      return withCors(json([...links.values()]));
    }

    if (request.method === "GET") {
      const fileResponse = await serveStatic(url.pathname);
      if (fileResponse) return withCors(fileResponse);
      const match = url.pathname.match(/^\/([A-Za-z0-9]{6})$/);
      if (match) {
        const link = links.get(match[1]);
        if (!link) return withCors(json({ error: "Short link not found" }, 404));
        link.hits += 1;
        return withCors(new Response(null, {
          status: 302,
          headers: { Location: link.url },
        }));
      }
    }

    return withCors(json({ error: "Not found" }, 404));
  },
});

console.log(`Snip backend listening on ${BASE_URL}`);
