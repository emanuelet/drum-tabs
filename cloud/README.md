# Cloudflare Deployment

The Cloudflare deployment is independent from the local Deno/MCP library. It uses D1 for metadata and R2 for tab and audio files. It accepts MP3 and OGG audio only.

## Provision

```bash
deno install
npx wrangler d1 create drum-tabs
npx wrangler r2 bucket create drum-tabs
```

Copy the returned D1 id into `wrangler.jsonc`, set `APP_ORIGIN`, then set the production secret:

```bash
npx wrangler secret put AUTH_SECRET
npx wrangler d1 migrations apply drum-tabs --remote
npx wrangler r2 bucket lifecycle set drum-tabs --file cloud/r2-lifecycle.json
```

The lifecycle rule removes soft-deleted R2 objects after 30 days. The daily Worker cron removes the corresponding D1 metadata.

## Import Local Tabs

Create the cloud account separately after migration. Local users, sessions, MCP access, and libraries intentionally remain local.

```bash
node cloud/import-local.mjs ./data drum-tabs drum-tabs
```

The importer copies each active `data/tabs/<id>` source file and audio attachment to R2, then creates matching tab, audio, and YouTube metadata in D1. It stops on the first failed upload or D1
command, making retries safe after removing or correcting the failed row/object.

## Deploy

The frontend build requires Deno because its Vite configuration uses JSR imports.

```bash
deno task build-frontend
npx wrangler deploy
```

Run `npx wrangler deploy --dry-run` after the frontend build to validate the Worker bundle without deploying it.
