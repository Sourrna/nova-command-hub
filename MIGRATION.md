# Nova Command Hub — Migration Note
Generated 2026-10-17. Local implementation complete. Transfer to Lovable project requires explicit approval.

## Files to transfer to the Lovable project

| File | Purpose |
|---|---|
| `src/lib/nova/notion.server.ts` | Read-only Notion adapter (`notionGet`, `notionSearch`, `notionFetchPage`, `notionListChildren`, `NOTION_VERSION`, `NotionResult<T>`) |
| `src/lib/nova/linkedin.server.ts` | Read-only LinkedIn adapter (`linkedinGet`, `linkedinOrganizations`, `linkedinPosts`, `linkedinMetrics`, `LinkedinResult<T>`) |
| `src/lib/nova/status.functions.ts` | Health check now calls `notionSearch("Nova")` and `linkedinOrganizations()` live |
| `src/routes/notion.tsx` | Route UI with loading / connected / missing / auth / rate / error branches, no demo data |
| `src/routes/linkedin.tsx` | Route UI with live organizations call, replacing demo preview |
| `src/components/nova/ConnectorViews.tsx` | `LIVE_ADAPTER` registry drives capability labels per connector |
| `src/test/notion.test.ts` | 9 tests: missing key, bearer header, 401/403/429, network failure, correct paths, credential non-leakage |
| `src/test/linkedin.test.ts` | 9 tests: missing key, bearer header, 401/403/429, network failure, correct paths, credential non-leakage |

## Files already in place (no transfer needed)

- `src/lib/nova/connectors.ts` — Notion and LinkedIn entries already declare the correct secrets
- `src/lib/nova/github.server.ts` — dual-transport GitHub adapter
- `.kilo/kilo.json` — Notion MCP + Ruflo MCP config

## Platform-specific runtime limitation

Secrets arrive as env vars injected at deploy time by Lovable into the Cloudflare Workers runtime (nitro preset `cloudflare-module`). No `.env` file exists in the repo; `process.env` is the sole read path in every adapter.

Required secrets in the Lovable Secrets panel:
- `NOTION_API_KEY` (already present per user)
- `LINKEDIN_ACCESS_TOKEN` (not yet present)

**A Lovable redeploy is required** so the published runtime picks up the new code and env vars. The published app at `nova-central-control.lovable.app` is stale — its built SSR files predate the Notion adapter.

## Verification (local)

- `bun test` → 43 pass, 0 fail, 116 expect() calls across 6 files
- `bunx tsc --noEmit` → clean
- `bun run build` → 3 builds succeeded
- Built SSR confirms `processModule.env["NOTION_API_KEY"]`, `processModule.env["LINKEDIN_ACCESS_TOKEN"]`, `notionSearch("Nova")`, `linkedinOrganizations()`, and `X-Restli-Protocol-Version` header

## Next action requiring approval

Trigger a Lovable redeploy. No commit, push, deploy, or external writes without explicit approval.