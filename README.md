# Snip workshop

One Bun backend, two clients: an Angular 19 web app and a zero-dependency Node CLI.
Links live in an in-memory Map. Restarting or redeploying deliberately clears them.

## Architecture

All branches belong to https://github.com/EugeneHSS/snip-workshop_day1.git.
Each component has independent history and files at its branch root. `main` is
the superproject: submodules mount exact commits, not floating branch contents.

| Branch / submodule | Responsibility |
| --- | --- |
| `backend` | Zero-dependency Bun `server.js` |
| `frontend` | Angular 19 `snip-frontend` |
| `cli` | Zero-dependency CommonJS `cli.js` and platform wrappers |
| `bundle` | Generated release; never edit its files by hand |
| `main` | Submodule pointers, build automation, documentation, CI |

Do not create component directories before mounting submodules. Git creates them.

## Shared API

| Method | Path | Request | Result |
| --- | --- | --- | --- |
| POST | `/api/links` | `{ "url": "https://example.com" }` | 201 `{ code, url, shortUrl, hits, createdAt }`; 400 `{ error }` for invalid JSON or non-HTTP(S) URLs |
| GET | `/api/links` | None | 200 array of link records |
| GET | `/:code` | None | 302 `Location` to original URL and one hit increment; 404 `{ error }` if unknown |

Codes contain six random base62 characters, hits begin at zero, and `createdAt`
is an ISO timestamp. Errors use `{ "error": "message" }`. CORS and OPTIONS allow
development clients on another origin. Existing public files take precedence
over same-named short codes.

## Clone and develop

Prerequisites: Git, Bun 1.x, Node 20+ (CI uses Node 24), npm, and optionally Docker.

```sh
git clone --branch main --recurse-submodules https://github.com/EugeneHSS/snip-workshop_day1.git
cd snip-workshop_day1
```

For an existing plain clone, run `git submodule update --init --recursive`.
Plain clones do not populate submodule files.

Run these in separate terminals from the superproject:

```sh
cd backend
bun start
```

```sh
cd frontend
npm ci
npm start
```

```sh
cd cli
node cli.js add https://example.com
node cli.js ls
```

Backend: http://localhost:3000. Frontend: http://localhost:4200. The frontend
uses same-origin `/api`; its development proxy forwards to the backend.
`SNIP_API` changes the CLI origin. `PORT` defaults to 3000; `BASE_URL` overrides
the origin used for short links, followed by HTTPS `RAILWAY_PUBLIC_DOMAIN`,
then localhost. `PUBLIC_DIR` enables static UI serving.

## Updating a component

Check that nobody else owns the shared checkout before changing branches.
Submodules may be detached; switch to the correct component branch before edits.

```sh
cd backend
git switch backend
# edit, verify, commit, and push this component
git push origin HEAD:backend
cd ..
git submodule update --remote backend
git add backend
git commit -m "Bump backend submodule"
git push origin main
```

The source commit and superproject pointer commit are separate. A recursive
checkout of an old `main` commit restores its exact pinned source revisions.
Keep the API contract synchronized across both clients and documentation.

## Assemble and verify a release

```sh
node scripts/smoke-test.mjs --source
node scripts/build-bundle.mjs
node scripts/build-bundle.mjs
node scripts/build-bundle.mjs --push
```

The builder runs on `main` and refuses uncommitted source, bundle, or superproject
edits. It collects remote source branch tips, freezes their exact SHAs in
`bundle/sources.json`, uses `npm ci` with the committed frontend lockfile, builds
the UI, and copies committed server/CLI bytes unchanged. The lockfile install is
the reproducible equivalent of the tutorial's `npm install`. Missing
`dist/snip-frontend/browser/index.html` is a hard error.

CLI tests and bundled API/static-asset smoke checks must pass before commits.
Only generated `bundle/public` is replaced; existing source work is never cleared.
The first run commits the bundle and its `main` pointers locally. An unchanged
second run makes no commits. `--push` pushes `HEAD:bundle` before `HEAD:main`,
including commits created by a previous non-push run. Neither push is forced.
This command publishes Git commits, **not** a container image.

```sh
cd bundle
bun start
# or:
docker build -t snip-workshop:local .
docker run --rm -p 3000:3000 snip-workshop:local
```

One process serves the UI, API and redirects. The image runs as the Bun user and
has an API health check. `PUBLIC_DIR` is set in the image; dotenv files are
excluded from its build context. No secrets belong in generated output.
The CLI stays CommonJS and needs Node when run as `node bundle/cli.js`.
For a bundled process already listening on a test origin, run
`node scripts/smoke-test.mjs --url http://127.0.0.1:3000`. This creates test links.
Set `BUN_EXECUTABLE` to an absolute Bun executable if Bun is not on PATH.

## CI and image promotion

- **Build bundle** runs hourly at minute 17 (UTC cron) and on manual dispatch,
  intentionally not on source pushes. It checks out `main`, collects remote source
  tips, verifies the assembled bundle, and pushes changed Git commits as the bot.
- **Build and push image** runs for `main` pushes changing the `bundle` gitlink
  or its own workflow file, plus manual dispatch. The path filter is `bundle`,
  not `bundle/**`. It checks out pinned submodules recursively, never remote tips.

Bot pushes made with `GITHUB_TOKEN` do not start another push workflow. After a
changed scheduled build, a separate `actions: write` job explicitly dispatches
the image workflow on `main`. An unchanged bundle creates neither commits nor an
image-workflow dispatch. Bundle writing has only `contents: write`; validation
jobs have read access; only the final promotion job gets `packages: write`.
All third-party Actions are pinned to immutable commit SHAs.

The image workflow checks source provenance and byte identity, runs frontend and
CLI tests, and smoke-tests the bundled API and static assets. `npm audit` rejects
high/critical dependency advisories. A digest-pinned Bun base, non-root Docker
candidate, API health check, and Trivy high/critical image scan are separate
checks; a clean OS scan does not clear frontend dependency findings.

**No candidate image artifact is uploaded and no GHCR login/push occurs unless
all tests and both security gates pass.** When allowed, promotion loads the exact
scanned image rather than rebuilding it, then tags
`ghcr.io/eugenehss/snip-workshop_day1:latest` and `:sha-<short-main-sha>`.
Those names describe the configured future outputs, not images already published.

After an approved successful publication:

```sh
docker run --rm -p 3000:3000 ghcr.io/eugenehss/snip-workshop_day1:latest
```

GHCR packages can initially be private; package visibility is a separate account
setting, not a reason to bypass release checks.

## Deployment readiness

The generated `railway.json` selects the Dockerfile builder and `/api/links`
health check. No Railway service or deployment is created by these workflows.
Deployment is blocked by the same security decision as image publication.

When a release is cleared, prefer deploying the verified immutable image digest;
do not enable automatic deployment directly from `bundle` while release gates
are failing. `main` is a superproject, not a standalone application build context.
Bind the service to its assigned `PORT` and make the public target port match it.
Set `BASE_URL` to the HTTPS public origin, or use `RAILWAY_PUBLIC_DOMAIN`.
Verify UI creation, CLI listing, redirects, hits, logs and health before promotion.
Roll back to the previous verified image digest on failure; memory-only link data
cannot be recovered by code rollback.

## Release security decision

The user explicitly chose **keep Angular 19; block image publishing** while
critical/high security checks fail. The committed frontend lockfile currently
reports 43 npm-audit findings: 2 critical, 14 high, 25 moderate, and 2 low.
Production-only audit reports 4 high and 3 moderate findings. These are dependency
advisories, not a claim that every issue is exploitable in this app.

Do not suppress audits, force major upgrades, publish an image, or deploy around
this gate. Bundle assembly and local verification may continue. A major Angular
upgrade requires a new user decision.
