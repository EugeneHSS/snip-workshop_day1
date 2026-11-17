import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = join(root, "bundle");
const sources = ["backend", "frontend", "cli"];
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--push")) throw new Error("Usage: node scripts/build-bundle.mjs [--push]");
const push = args.includes("--push");
const trailers = [
  "-m", "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>",
  "-m", "Co-authored-by: OpenBot <335604065+openbotgit[bot]@users.noreply.github.com>",
];

function run(file, parameters, cwd = root) {
  execFileSync(file, parameters, { cwd, stdio: "inherit", env: process.env });
}
function git(parameters, cwd = root) {
  return execFileSync("git", parameters, { cwd, encoding: "utf8" }).trim();
}
function npm(parameters, cwd) {
  if (process.platform !== "win32") return run("npm", parameters, cwd);
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    ...(process.env.PATH || "").split(delimiter).map((path) => join(path, "node_modules", "npm", "bin", "npm-cli.js")),
  ];
  const entry = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!entry) throw new Error("npm-cli.js was not found; install npm with Node or run through npm.");
  run(process.execPath, [entry, ...parameters], cwd);
}
function requireClean(path) {
  if (git(["status", "--porcelain"], path)) throw new Error(`Refusing to overwrite uncommitted changes in ${path}`);
}
function commitIfChanged(cwd, message) {
  if (!git(["diff", "--cached", "--name-only"], cwd)) return false;
  run("git", ["diff", "--cached", "--check"], cwd);
  run("git", ["commit", "-m", message, ...trailers], cwd);
  return true;
}
function write(name, value) {
  writeFileSync(join(bundle, name), value);
}

if (git(["branch", "--show-current"]) !== "main") throw new Error("Run the bundle builder from main, not a component branch.");
const initialChanges = git(["status", "--porcelain", "--ignore-submodules=all"]);
if (initialChanges) throw new Error(`Commit or remove superproject edits before assembling a release:\n${initialChanges}`);
for (const name of [...sources, "bundle"]) {
  const path = join(root, name);
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`Submodule path must not be a symlink: ${name}`);
  if (existsSync(join(path, ".git"))) requireClean(path);
}
run("git", ["submodule", "update", "--init", "--recursive"]);
for (const name of [...sources, "bundle"]) requireClean(join(root, name));
run("git", ["submodule", "update", "--init", "--remote", ...sources]);
const revisions = Object.fromEntries(sources.map((name) => [name, git(["rev-parse", "HEAD"], join(root, name))]));
const frontend = join(root, "frontend");
// A committed lockfile is required so a scheduled rebuild cannot silently resolve new packages.
if (!existsSync(join(frontend, "package-lock.json"))) throw new Error("frontend/package-lock.json is required.");
npm(["ci", "--no-audit", "--no-fund"], frontend);
npm(["run", "build"], frontend);
const publicSource = join(frontend, "dist", "snip-frontend", "browser");
if (!existsSync(join(publicSource, "index.html"))) throw new Error("Missing frontend/dist/snip-frontend/browser/index.html");
if (lstatSync(bundle).isSymbolicLink()) throw new Error("Refusing to assemble through a bundle symlink.");
const publicTarget = join(bundle, "public");
if (existsSync(publicTarget) && lstatSync(publicTarget).isSymbolicLink()) throw new Error("Refusing to replace a symlink at bundle/public.");
rmSync(publicTarget, { recursive: true, force: true });
cpSync(publicSource, publicTarget, { recursive: true });
for (const [component, file] of [["backend", "server.js"], ["cli", "cli.js"]]) {
  // Copy canonical committed bytes, avoiding Windows checkout line-ending conversions.
  write(file, execFileSync("git", ["show", `HEAD:${file}`], { cwd: join(root, component) }));
}
write(".gitattributes", "* text=auto eol=lf\n");
write(".env", "PUBLIC_DIR=./public\n");
write("package.json", `${JSON.stringify({
  name: "snip-bundle", version: "1.0.0", private: true,
  scripts: { start: "bun server.js" },
}, null, 2)}\n`);
write("Dockerfile", `FROM oven/bun:1-alpine@sha256:4cf82f5686b196504fe119db3fcd9185b191f82ece82c40680e597228ec6070a
WORKDIR /app
COPY --chown=bun:bun . .
ENV PORT=3000 PUBLIC_DIR=./public
EXPOSE 3000
USER bun
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD bun -e 'const r = await fetch("http://127.0.0.1:" + process.env.PORT + "/api/links"); if (!r.ok) process.exit(1)'
CMD ["bun", "server.js"]
`);
write(".dockerignore", ".git\n.gitignore\n.env*\nnode_modules\n*.test.js\n");
write("railway.json", `${JSON.stringify({
  $schema: "https://railway.com/railway.schema.json",
  build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
  deploy: { healthcheckPath: "/api/links", healthcheckTimeout: 30, restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 3 },
}, null, 2)}\n`);
write("sources.json", `${JSON.stringify({
  ...revisions,
  frontendLockSha256: createHash("sha256").update(execFileSync("git", ["show", "HEAD:package-lock.json"], { cwd: frontend })).digest("hex"),
}, null, 2)}\n`);
write("README.md", `# Generated Snip bundle

Generated from the source commits in sources.json. Do not edit by hand.
Rebuild with node scripts/build-bundle.mjs from main.

Run bun start for UI, API and redirects on PORT (default 3000).
The CLI is copied unchanged; use node cli.js on a host with Node installed.
The minimal Docker image contains Bun, not Node.
Links reset on restart. BASE_URL overrides the public short-link origin.

Image publishing and deployment are BLOCKED while critical/high security checks
fail. The user chose to retain Angular 19; do not bypass the release gates.
`);
run(process.execPath, ["--test", "cli.test.js"], join(root, "cli"));
run(process.execPath, [resolve(root, "scripts", "smoke-test.mjs")]);
for (const name of sources) {
  requireClean(join(root, name));
  if (git(["rev-parse", "HEAD"], join(root, name)) !== revisions[name]) throw new Error(`${name} moved during the build.`);
}
run("git", ["add", "--all"], bundle);
const bundleChanged = commitIfChanged(bundle, "Generate verified local Snip bundle");
run("git", ["add", "--", ...sources, "bundle"]);
const mainChanged = commitIfChanged(root, "Pin Snip source and bundle revisions");
if (push) {
  // Push even after a local no-op, so a preceding non-push run can be published safely.
  run("git", ["push", "origin", "HEAD:bundle"], bundle);
  run("git", ["push", "origin", "HEAD:main"]);
}
console.log(bundleChanged || mainChanged ? "Bundle assembled and pinned." : "Bundle unchanged; nothing to commit.");
