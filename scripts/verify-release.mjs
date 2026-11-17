import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const git = (args, cwd = root) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const provenance = JSON.parse(readFileSync(join(root, "bundle", "sources.json"), "utf8"));
for (const name of ["backend", "frontend", "cli", "bundle"]) {
  const entry = git(["ls-tree", "HEAD", "--", name]).match(/^160000 commit ([a-f0-9]{40})\t/);
  assert.ok(entry, `${name} must be a committed gitlink`);
  assert.equal(git(["rev-parse", "HEAD"], join(root, name)), entry[1], `${name} checkout differs from pinned commit`);
  assert.equal(git(["status", "--porcelain"], join(root, name)), "", `${name} has uncommitted changes`);
  if (name !== "bundle") assert.equal(provenance[name], entry[1], `${name} differs from generated provenance`);
}
for (const [component, file] of [["backend", "server.js"], ["cli", "cli.js"]]) {
  const expected = execFileSync("git", ["show", `HEAD:${file}`], { cwd: join(root, component) });
  assert.ok(expected.equals(readFileSync(join(root, "bundle", file))), `${file} must match committed source byte for byte`);
}
const lock = execFileSync("git", ["show", "HEAD:package-lock.json"], { cwd: join(root, "frontend") });
assert.equal(createHash("sha256").update(lock).digest("hex"), provenance.frontendLockSha256);
const pkg = JSON.parse(readFileSync(join(root, "bundle", "package.json"), "utf8"));
assert.equal(pkg.type, undefined, "Bundled CLI must remain CommonJS");
assert.equal(readFileSync(join(root, "bundle", ".env"), "utf8"), "PUBLIC_DIR=./public\n");
const publicDir = join(root, "bundle", "public");
assert.ok(existsSync(join(publicDir, "index.html")), "Bundled Angular index is missing");
for (const name of readdirSync(publicDir).filter((name) => name.endsWith(".js"))) {
  assert.ok(!/https?:\/\/localhost:3000/.test(readFileSync(join(publicDir, name), "utf8")), "Production UI must not call localhost");
}
console.log(`PASS pinned submodules, source bytes, lockfile provenance, CommonJS, production UI (${git(["rev-parse", "--short", "HEAD"])})`);
