<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture
- Connectors are declared in `src/lib/nova/connectors.ts` (typed registry); pages reuse `ConnectorViews` — keeps cards/details consistent.
- Connector health comes only from `status.functions.ts` (server env presence check); never report "connected" without a verified live call.
- App state lives in `src/lib/nova/store.ts` (localStorage, MVP); all publish/write actions go through the approval gate and are logged.
- AI provider calls live in `src/lib/nova/ai.server.ts` (injectable fetch, sanitized error codes) and are exposed via `ai.functions.ts`; health marks AI connectors connected only after a live `/models` call — keeps keys server-side and statuses truthful.
