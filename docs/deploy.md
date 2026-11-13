# Deploying Siegemate

Live: **https://siegemate.pages.dev** (Cloudflare Pages project `siegemate`, production branch `main`).
Every deployment also gets its own preview URL (`https://<id>.siegemate.pages.dev`).

The deploy is a Pages *Direct Upload* in three steps.

1. **Build** (the asset budget check runs first):
   ```bash
   VITE_BUILD_ID=$(git rev-parse --short HEAD) npm run build
   ```
2. **Upload token** (Cloudflare MCP `execute`; the token lasts 30 minutes and only uploads files to this project):
   ```js
   async () => (await cloudflare.request({ method: "GET",
     path: `/accounts/${accountId}/pages/projects/siegemate/upload-token` })).result.jwt
   ```
3. **Upload the files**, skipping any Cloudflare already has (content-addressed):
   ```bash
   CF_PAGES_JWT=<token> node tools/deploy-pages.mjs dist .perf/pages-manifest.json
   ```
4. **Create the deployment** (Cloudflare MCP `execute`): POST a multipart form to
   `/accounts/${accountId}/pages/projects/siegemate/deployments` with fields `manifest` (the JSON from step 3; `.perf/pages-manifest.json.gz.b64` is the same gzipped, which the MCP sandbox can gunzip with DecompressionStream),
   `_headers` (the contents of `dist/_headers`), `branch=main`, `commit_hash`, `commit_message`.

Check afterwards:
```bash
curl -sI https://siegemate.pages.dev/ | grep -i cache-control       # no-cache
curl -s https://siegemate.pages.dev/ | grep -o '<title>[^<]*</title>'
```

`public/_headers` holds the cache rules. Hashed code under `/build` is cached forever, `/assets` (stable
names) for a day with revalidation, and the page itself is never cached.
