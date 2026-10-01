# Model Arena deployment

Status on 1 October 2026: AWS authentication, free comparison and controlled paid generation checks passed. The original baseline and authenticated local comparison, grading, summary, export-button and reload flow passed, including desktop/390px light/dark and two-account browser-state separation. The production build, 12 client checks, 16 backend checks and 15 actual Auth.js HTTP checks passed. Ordinary live runtime is verified after removal of the temporary proof guard.

Origin: `https://model-arena.3-6-183-210.sslip.io`. Service slug `model-arena`, SSM prefix `/portfolio/model-arena/`, PostgreSQL database/role `model_arena`. The deployed container uses Node 24, Next.js standalone output, a non-root runtime, read-only root filesystem and `/api/healthz`, with a 768 MiB/1 CPU limit and CloudWatch logging. There is no media pipeline and no S3 upload requirement for this browser-owned comparison tool.

Accounts, revocable sessions, rate controls and usage accounting live in PostgreSQL. Corpus/prompts/results/grades remain in owner-scoped browser storage. That storage is not encrypted or synchronized; it is separate from the server security boundary. Server cookies, session-row checks, exact-origin CSRF and owner-bound usage protect API operations. Old global browser records are never silently assigned to a new account.

Hosted configuration uses `PUBLIC_ORIGIN` / `AUTH_URL`, private `AUTH_SECRET`, `DATABASE_URL`, `DATABASE_SSL_CA_FILE`, server-only `HF_TOKEN` / `GEMINI_API_KEY`, and `MODEL_ARENA_MOCK_MODE`. The database uses certificate-verified TLS. `PORTFOLIO_AUTH_ENABLED=0` is rejected.

A local mock integration is explicitly loopback-only: `MODEL_ARENA_LOCAL_PREVIEW=1`, `MODEL_ARENA_BIND_HOST=127.0.0.1`, `MODEL_ARENA_MOCK_MODE=1`, a matching HTTP loopback origin and separate loopback PostgreSQL database. Only that local fixture may use `DATABASE_SSL=disable`; both provider keys must be absent. Credentials and test account files remain outside git. The application initializes its additive schema from `migrations/001_portfolio.sql` and rejects incompatible existing user tables.

The default `.next` build preserves the original baseline. `MODEL_ARENA_DIST_DIR=.next-integrated` is used for the integrated preview/build. Packaging and secrets are handled by the infrastructure workstream. Do not run the historical Vercel deployment helper for this launch.

Prepared examples call the normal generate/grade endpoints with a canonical server example identity; client-supplied answer overrides do not turn them into free provider calls. Editing any input leaves prepared mode visibly. Hosted model routes require an available verified price and bounded usage. A normal multi-model Run followed by Grade makes multiple provider calls; the recorded proof below covers one generation only.

## Deployed verification

Image `portfolio/model-arena:99f2d2130ef16ee7` (ID `sha256:83cd4284466737f5b23e35b747d10cc50e54b3bd27236b2273c43ee77de16a60`) is running with authentication enabled and mock mode off, ordinary `node server.js`, no proof mounts and verified PostgreSQL TLS 1.3. The free example remains server-owned and makes no provider call in ordinary live mode.

Live HTTP checks passed 11 gate groups covering two durable users, anonymous denial, stable/replay-resistant CSRF, canonical example overrides, session revocation/relogin, catalogs, and unchanged prior users/paid ledger. Root browser verified the deployed prepared comparison, summaries, reload and both themes without console errors. After ordinary live restoration, a final reload and prepared Run6/Grade3 passed again with no console errors. Export buttons were exercised; browser-downloaded files were not independently parsed.

The single paid proof ran the normal `/api/generate` route on 1 October 2026, with the client request from 06:25:01.875189 to 06:25:03.098083 UTC. Hugging Face routed `Qwen/Qwen3-4B-Instruct-2507:nscale` at max64/temperature0 and returned “Christopher Nolan”. One dispatch/HTTP200 matched one completed owner usage row: 19 input, 3 output, 0 cached and 0 reasoning tokens. Estimated USD 0.00000028 uses USD0.01/input-million and USD0.03/output-million catalog rates, not invoice billing. Twenty-two independent audit checks matched the retained provider response, HTTP deliverable, claims and ledger. No paid Gemini grading or full paid matrix was exercised.

The initial operator stage rejected the legitimate NextAuth catch-all path before activation or dispatch. Segment-aware validation fixed that operator-only issue, preserving the rejected guard bytes. There was one actual paid dispatch, no paid retry. Proof evidence was sealed and ordinary live configuration restored; provider/account availability and shared allowance remain runtime limits.
