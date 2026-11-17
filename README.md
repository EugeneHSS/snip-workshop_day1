# Snip frontend

Angular 19 client for the shared Snip API: one standalone component, reactive URL
form, signals for state, and a typed HttpClient service. Requires Node 20.11+ (or
Node 22/24) and npm.

## Development

Run the backend on port 3000, then:

```sh
npm ci
npm start
```

Open http://localhost:4200. Angular proxies `/api` to http://localhost:3000;
requests stay same-origin in production so the bundled UI works on any host.
Short links use the backend-provided `shortUrl`, not the development UI origin.

The form accepts only absolute HTTP(S) URLs and blocks duplicate pending requests.
Validation and server errors appear inline. Successful creation refreshes the
table; Refresh also reloads hit counts after short links have been opened.
Links are in memory on the backend and disappear on restart.

## Shared API

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| POST | `/api/links` | `{ "url": "https://example.com" }` | 201 `{ code, url, shortUrl, hits, createdAt }`; 400 `{ error: string }` |
| GET | `/api/links` | none | 200 array of those records |
| GET | `/:code` | none | 302 redirect and one hit; 404 if unknown |

`code`, `url`, `shortUrl`, and ISO `createdAt` are strings; `hits` is a number.
The table preserves server ordering. Loading and error states are distinct from
an empty response; a failed refresh retains previously loaded rows with a warning.

## Verification and release

```sh
npm test -- --watch=false --browsers=ChromeHeadless
npx ng build
```

Tests use Angular's HTTP test backend for validation, pending requests, creation,
refresh, and API/network failures. The test runner needs Chrome/Chromium installed
(set `CHROME_BIN` if needed).

Production output **must** remain `dist/snip-frontend/browser` for the bundle
builder. Serve that directory using backend `PUBLIC_DIR`; do not hardcode a
localhost API origin in the production client.

Source files live at the root of orphan branch `frontend`. After committing and
pushing that branch, separately update the `frontend` submodule pointer on `main`.
The generated `bundle` branch is not source and must not be hand-edited.

## Dependency limitation

The tutorial requires Angular 19. At implementation, `npm audit` reports 43
affected dependency packages (2 critical, 14 high, 25 moderate, 2 low); the
production-only audit reports 7 (4 high, 3 moderate). Critical advisories are in
build tools `tar` and `piscina`; production advisories include Angular itself.
The reported fixes require a major Angular/toolchain upgrade, outside this
tutorial's pinned version. These findings are not proof that each advisory is
reachable in this app; they remain unresolved and require review before a public
production release. Do not use `npm audit fix --force` without coordinating the
version change with integration.
