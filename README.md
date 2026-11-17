# Snip CLI

Zero-dependency Node 20+ client for the shared Snip API. Files live at the root of
the independent-history `cli` branch; `main` mounts this branch as a submodule.

```sh
node cli.js help
node cli.js add https://example.com
node cli.js ls
node cli.js open Ab12Cd
```

Use `./snip` on Linux/macOS, `.\snip.cmd` in cmd.exe, or `.\snip.ps1` in
PowerShell. The package also exposes a `snip` bin for `npm link`. Wrappers preserve
arguments and exit status; quote URLs containing shell special characters.

`SNIP_API` configures the API origin, default `http://localhost:3000`.
For example, PowerShell: `$env:SNIP_API = 'https://snip.example.com'`.
Only HTTP(S) origins without credentials, paths, queries, or fragments are accepted.
Requests time out after 10 seconds, including reading response bodies.

- `add <url>` validates HTTP(S), posts `{url}` to `/api/links`, and prints only the
  returned `shortUrl`.
- `ls` gets `/api/links` and prints aligned code/hits/url columns, or `No links yet.`.
- `open <code>` accepts six base62 characters, requests `/:code` without following
  redirects, then opens the 302 `Location` target using Windows `start`, macOS
  `open`, or Linux `xdg-open`. Redirect targets must use HTTP(S).
- No arguments, `help`, `--help`, or `-h` prints usage.

Success exits 0. Bad arguments, unknown codes, invalid API configuration or
responses, API/network errors, timeouts, and browser-launch failures print to
stderr and exit 1. `open` is silent on success. Its request records one hit before
launching; a failed launch cannot undo that hit. A launcher exit of 0 confirms
dispatch, not that a browser finished loading the page. Headless systems need a
configured graphical browser for `open`.

The shared link shape is `{code,url,shortUrl,hits,createdAt}`. POST returns 201,
list returns 200, redirects return 302, missing codes return 404, and API errors
use `{error:string}`. The backend stores links in memory; restarts clear them.

Run `npm test` for argument/output/exit-code tests, a local mock HTTP API, timeout
and redirect checks, and platform launcher construction. Actual graphical browser
launches must also be checked on each supported OS.

Keep `cli.js` CommonJS: do not add `"type":"module"`. The generated `bundle` branch
copies this file unchanged and runs it with plain Node. Never hand-edit the bundle.
