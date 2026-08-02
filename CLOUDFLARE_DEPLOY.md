# Cloudflare Workers Static Assets

The project is deployed as a static Worker using the committed `wrangler.jsonc` configuration.

## Deploy

```bash
npx wrangler deploy
```

The asset directory remains the repository root because `index.html` imports ES modules from `src/` directly. The root `.assetsignore` file prevents development-only content such as `node_modules/`, tests, CI metadata, and Wrangler caches from being uploaded.

Do not remove the `node_modules/` rule from `.assetsignore`: Wrangler includes every non-ignored file below `assets.directory`, while Cloudflare limits an individual static asset to 25 MiB.
