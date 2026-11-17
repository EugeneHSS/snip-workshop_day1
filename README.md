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

## Release security decision

The user explicitly chose **keep Angular 19; block image publishing** while
critical/high security checks fail. The committed frontend lockfile currently
reports 43 npm-audit findings: 2 critical, 14 high, 25 moderate, and 2 low.
Production-only audit reports 4 high and 3 moderate findings. These are dependency
advisories, not a claim that every issue is exploitable in this app.

Do not suppress audits, force major upgrades, publish an image, or deploy around
this gate. Bundle assembly and local verification may continue. A major Angular
upgrade requires a new user decision.
