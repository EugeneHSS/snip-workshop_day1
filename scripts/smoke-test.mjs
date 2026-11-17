import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const root = fileURLToPath(new URL("../", import.meta.url));

function command(file, args, options = {}) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(file, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) reject(new Error(`${file} ${args.join(" ")} exited ${code}: ${stderr}`));
      else resolveCommand(stdout);
    });
  });
}

async function unusedPort() {
  const listener = createServer();
  await new Promise((resolveListen, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolveListen);
  });
  const { port } = listener.address();
  await new Promise((resolveClose, reject) => listener.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

async function verify(base, cli, staticUi) {
  const request = (path, options = {}) => fetch(`${base}${path}`, {
    ...options, redirect: "manual", signal: AbortSignal.timeout(10000),
  });
  const preflight = await request("/api/links", { method: "OPTIONS" });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
  for (const body of ['{"url":', '{"url":"javascript:alert(1)"}']) {
    const response = await request("/api/links", {
      method: "POST", headers: { "content-type": "application/json" }, body,
    });
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, "string");
  }
  const original = `https://example.com/snip-smoke?run=${Date.now()}`;
  const response = await request("/api/links", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: original }),
  });
  assert.equal(response.status, 201);
  const link = await response.json();
  assert.deepEqual(Object.keys(link).sort(), ["code", "createdAt", "hits", "shortUrl", "url"]);
  assert.match(link.code, /^[A-Za-z0-9]{6}$/);
  assert.equal(link.url, original);
  assert.equal(link.hits, 0);
  assert.equal(new Date(link.createdAt).toISOString(), link.createdAt);
  assert.equal(link.shortUrl, `${base}/${link.code}`);
  const list = await request("/api/links");
  assert.equal(list.status, 200);
  assert.deepEqual((await list.json()).find((item) => item.code === link.code), link);
  const redirect = await request(`/${link.code}`);
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), original);
  assert.equal((await (await request("/api/links")).json()).find((item) => item.code === link.code).hits, 1);
  assert.equal((await request("/zzzzzz/missing")).status, 404);
  const env = { ...process.env, SNIP_API: base };
  const output = await command(process.execPath, [cli, "ls"], { env });
  assert.ok(output.includes(link.code) && output.includes(original), "CLI must see the API-created link");
  const created = (await command(process.execPath, [cli, "add", "https://example.org/from-cli"], { env })).trim();
  assert.ok(created.startsWith(`${base}/`), "CLI must return the configured API origin");
  const afterCli = await (await request("/api/links")).json();
  assert.ok(afterCli.some((item) => item.shortUrl === created && item.url === "https://example.org/from-cli"));
  if (staticUi) {
    const page = await request("/");
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<app-root/);
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => match[1]);
    assert.ok(assets.length > 0, "Built UI must reference its generated assets");
    for (const asset of assets) assert.equal((await request(`/${asset.replace(/^\//, "")}`)).status, 200);
  }
  console.log(`PASS ${staticUi ? "bundled UI + " : ""}API/CLI: create, list, redirect, hits, errors, CORS`);
}

async function main() {
  const args = process.argv.slice(2);
  const source = args.includes("--source");
  const urlIndex = args.indexOf("--url");
  const cli = resolve(root, source ? "cli/cli.js" : "bundle/cli.js");
  if (urlIndex !== -1) {
    const base = args[urlIndex + 1];
    if (!base || new URL(base).origin !== base) throw new Error("--url requires an origin with no trailing slash");
    await verify(base, cli, !source);
    return;
  }
  assert.ok(args.every((arg) => arg === "--source"), "Usage: node scripts/smoke-test.mjs [--source] [--url origin]");
  const port = await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  const cwd = resolve(root, source ? "backend" : "bundle");
  const env = { ...process.env, PORT: String(port), BASE_URL: base };
  if (source) delete env.PUBLIC_DIR;
  else env.PUBLIC_DIR = "./public";
  const child = spawn(process.env.BUN_EXECUTABLE || "bun", ["server.js"], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let startupError;
  let exited = false;
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  child.once("error", (error) => { startupError = error; });
  const closed = new Promise((resolveClose) => child.once("close", () => { exited = true; resolveClose(); }));
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (startupError) throw startupError;
      if (exited) throw new Error(`Server exited before readiness: ${output}`);
      try {
        ready = (await fetch(`${base}/api/links`, { signal: AbortSignal.timeout(500) })).ok;
      } catch (error) {
        if (attempt === 99) throw new Error(`Server did not become ready: ${output}`, { cause: error });
      }
      if (ready) break;
      await sleep(100);
    }
    assert.ok(ready, `Server did not become ready: ${output}`);
    await verify(base, cli, !source);
  } finally {
    if (!exited) child.kill();
    await closed;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
