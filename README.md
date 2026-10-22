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

### Current capability and data boundaries

- Command Center supports AI draft generation and GitHub repository, open issue,
  pull request, branch, and commit reads. GitHub issue and pull-request goals
  route to their corresponding read operation; a specific issue or PR number
  requests that item. Goals default to `Sourrna/nova-brand-ai` unless an
  `owner/repo` value or GitHub repository URL is provided. Provider results and
  failures are recorded in the local execution history.
- GitHub issue/branch/PR creation is not implemented and is not offered as an
  available capability.
- Notion search and LinkedIn organization reads use server-side credentials.
  Connector health is reported as connected only after the adapter's live read
  succeeds.
- Notion page writes and LinkedIn publishing remain disabled. The application
  does not have a shared atomic approval store or authenticated user/ownership
  context, so a local approval record cannot authorize a provider write.
  Provisioning a database or Durable Object alone is insufficient: the durable
  grant/consume/revoke path and authenticated request ownership must also be
  implemented and verified before enabling these actions.
- Tasks, drafts, projects, executions, approval requests, and activity history
  are persisted in this browser's local storage. They survive refreshes and
  remounts and synchronize across tabs in the same browser profile; they are
  not shared across users, devices, or browser profiles. Use Settings > Backup
  & restore to export or import a workspace.

### Verification

```sh
npm test
npx tsc --noEmit
npm run build
```
