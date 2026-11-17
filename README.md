# Snip backend

A zero-dependency Bun URL shortener. Links are held in memory and reset when the
server restarts.

```sh
bun start
```

The server listens on `PORT` (default `3000`). Set `BASE_URL` to the public
origin used in generated short links. Otherwise it uses
`https://$RAILWAY_PUBLIC_DOMAIN` when set, or `http://localhost:$PORT`.
Optionally set `PUBLIC_DIR` to serve static files; `/` serves `index.html`, and
an existing file takes precedence over a matching short code.

## API

- `POST /api/links` with `{"url":"https://example.com"}` creates a link and
  returns `201` with `{code,url,shortUrl,hits,createdAt}`.
- `GET /api/links` returns all links.
- `GET /:code` redirects to the original URL and increments its hit count.
- Invalid creation input returns `400`; an unknown code returns `404`.
