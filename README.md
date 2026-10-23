# Nova Command Hub

Build NOVA BRAND OS as a usable, polished personal-brand automation command center, not a portfolio/resume or generic SaaS dashboard. This is an MVP build: prioritize working UX and coherent navigation over placeholder feature claims. Visual direction: JARVIS/Tony Stark operations cockpit, dark charcoal #171717/#2B2B2B, restrained burgundy #5B1E2D, silver/white, subtle holographic glass panels, crisp telemetry, responsive mobile/desktop, accessibility, Persian RTL + English support where practical. Create a central overview with operational status, quick actions, recent activity, active projects, content pipeline, connector health, and next actions. Include pages/modules for: Command Center, Nova Core (tasks/plan/execution history), Plugin Hub, AI Models (OpenAI/ChatGPT and xAI/Grok), Notion, Lovable, GitHub, LinkedIn, Content Studio (idea→strategy→draft→review→approved→published→measured), Projects, Memory, Activity/Audit Log, Settings. Make connector states truthful: Connected, Needs setup, Limited, Disconnected; never simulate a successful external action. Where credentials/API scopes are absent, provide a clear connection/setup screen and safe demo/sample data labeled as demo. Build an extensible connector registry with typed capability/status definitions and consistent connector cards/details, plus an operation log and approval gate for publish/write/destructive actions. Local persistence is acceptable for MVP; isolate provider adapters and do not expose secrets in client code. Use environment/server-side secrets for APIs. Add useful empty states, search/filter, responsive sidebar/topbar, and real interactions for local task/content/project management. Reuse existing scaffold architecture and avoid overengineering. Do not deploy/publish. When done, report files/features actually implemented, checks run, and blockers. Keep token use efficient: one coherent implementation pass, no plan-only response.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/ae0c986d-3648-466b-b493-21aaf1850e67).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

### Server-side connector configuration

Connector credentials are read by server-side adapters only. Do not add them to
`VITE_*` variables, browser storage, or checked-in files. Configure the
following as server environment secrets, then re-check connector health:

| Variable | Capability |
| --- | --- |
| `OPENAI_API_KEY` | Live-verified OpenAI model access and draft generation |
| `XAI_API_KEY` | Live-verified xAI model access and draft generation |
| `NOTION_API_KEY` | Live Notion search/read access |
| `GITHUB_API_KEY` | Optional GitHub API authentication; public repository reads also work unauthenticated with lower rate limits |
| `LOVABLE_API_KEY` | Optional Lovable GitHub connector gateway; used with `GITHUB_API_KEY` |
| `LINKEDIN_ACCESS_TOKEN` | Live LinkedIn organization/read access when the token has the required API permissions |

### Durable workspace and approval setup

The application includes owner-scoped D1 workspace storage and a Cloudflare
Access JWT identity boundary. They are **not active by default**: this repository
does not include a provisioned D1 database or an Access application. Until both
are configured, the UI explicitly reports local-only storage, and the existing
Notion/LinkedIn mutation paths remain disabled. No client-supplied user ID is
accepted as identity.

1. Create a Cloudflare Access self-hosted application for the application URL.
   Configure its team domain and application audience tag as Worker variables
   `CLOUDFLARE_ACCESS_TEAM_DOMAIN` and `CLOUDFLARE_ACCESS_AUD`. The verifier
   accepts only signed, unexpired RS256 Access JWTs for that issuer and audience.
2. Create a D1 database with `npx wrangler d1 create nova-command-hub` and bind
   it to the Worker as `NOVA_DB`. The binding name is case-sensitive. Copy
   `wrangler.example.toml` to `wrangler.toml` and set the database name/id
   returned by Cloudflare:

   ```toml
   [[d1_databases]]
   binding = "NOVA_DB"
   database_name = "nova-command-hub"
   database_id = "<database id from wrangler d1 create>"
   migrations_dir = "migrations"
   ```

3. Apply the schema to a local D1 database with
   `npx wrangler d1 migrations apply nova-command-hub --local`. After reviewing
   the schema and configuring a real database binding, apply to that database
   with `npx wrangler d1 migrations apply nova-command-hub --remote`. Remote
   migration changes production data and must be deliberately authorized; it
   was not run as part of this implementation.
4. For local Worker runs, copy `.env.example` to `.dev.vars` and enter only the
   non-secret Access domain/audience values. Do not commit `.dev.vars`. D1 is
   supplied as a Worker binding and cannot be configured in `.env`. After
   replacing the D1 id in `wrangler.toml`, run `npm run build` and
   `npx wrangler dev` to exercise the Cloudflare Worker runtime and its local
   D1 instance. Requests served directly from localhost will not have a verified
   Cloudflare Access JWT, so the app correctly remains local-only there unless
   traffic is routed through a real Access-protected hostname. There is no
   development identity bypass. Wrangler is not a project dependency;
   install/use it according to your Cloudflare environment.
5. For GitHub mutations, configure `GITHUB_API_KEY` as a server-only Worker
   secret with only the repository permissions required by the requested
   operation. The server-side request/approve/execute endpoints create an
   owner-bound, expiring D1 approval; the adapter is called only after
   authenticated approval and atomic single-use consumption. Provider IDs/URLs
   and final outcomes are recorded in D1. The GitHub operation form and
   Activity approval controls are connected to this flow, but it has not been
   tested against Cloudflare or GitHub in this environment. Command Center
   does not infer GitHub mutation payloads from free-form goals.

Workspace documents are validated and saved with an owner-scoped optimistic
revision. On first use with D1, locally saved records absent from the durable
workspace are merged by record ID; durable records win ID conflicts. Subsequent
changes are synchronized to D1. If Access, D1, or persistence fails, the
application stays usable in browser-local mode and displays that state rather
than claiming cloud sync. A revision conflict is surfaced for explicit retry.
Approval requests store the exact canonical payload and hash, enforce
owner-scoped idempotency, expiry, rejection/revocation, and atomic
approved-to-executing consumption. A provider-confirmed result whose final D1
status cannot be saved is reported as an audit persistence failure and must not
be retried.

### Current capability and data boundaries

- Command Center supports AI draft generation and GitHub repository, open issue,
  pull request, branch, and commit reads. GitHub issue and pull-request goals
  route to their corresponding read operation; a specific issue or PR number
  requests that item. Goals default to `Sourrna/nova-brand-ai` unless an
  `owner/repo` value or GitHub repository URL is provided. Provider results and
  failures are recorded in the local execution history.
- GitHub issue creation/update, branch creation, and pull-request creation have
  a validated request form, server-side operation mapping, an authenticated
  durable approval lifecycle, and a write adapter. Mutations remain unavailable
  until Cloudflare Access, D1, and a sufficiently scoped GitHub token are
  configured. The Command Center does not infer unsafe mutation payloads from
  free-form goals; use the GitHub operation form. When enabled, the token needs
  Issues read/write for issue changes,
  Contents read/write for branch creation, and Pull requests read/write for PR
  creation.
- Notion search and LinkedIn organization reads use server-side credentials.
  Connector health is reported as connected only after the adapter's live read
  succeeds.
- Notion page writes and LinkedIn publishing remain disabled. Their existing
  provider handlers have not yet been migrated to the new D1 approval lifecycle;
  a local or synchronized workspace approval cannot authorize a provider write.
  Provisioning a database or Durable Object alone does not enable either
  provider.
- Until the Cloudflare Access and D1 bindings above are provisioned, tasks,
  drafts, projects, executions, approval requests, and activity history remain
  in this browser's local storage. They survive refreshes and remounts and
  synchronize across tabs in the same browser profile; they are not shared
  across users, devices, or browser profiles. Use Settings > Backup & restore
  to export or import a workspace.

### Verification

```sh
npm test
npx tsc --noEmit
npm run build
```
