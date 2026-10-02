# Model Arena — handoff
last-synced: 8d96f62 (deployed runtime checkpoint; documentation verified 2026-10-02)

## Current state
- User requested a full 12-category FMEA, at least 100 possible scenarios, and a Configure tab for Gemini/OpenAI/Claude grader keys.
- Implemented session-memory BYOK grading, provider-specific schema adapters, actionable errors, preserved answers, truncation notices, import validation/order gates, safe failure telemetry, and a PostgreSQL TLS URL-override fix.
- Keys never enter browser persistence, exports or the server ledger. BYOK cost is unknown and billed by the user's provider; hosted HF budget is separate.
- Free checks passed: 87 backend tests, 29 client tests, 37 normal-auth HTTP checks and an isolated production build. Receipts live in `docs/qa/2026-10-02/`. The matrix has 122 scenarios: 18 addressed, 95 controlled, 5 residual risks, 2 product limits, 1 historical diagnostic limit and 1 unverified load case; these are not 122 observed defects.
- Local preview: 8994 (mock core), 8995 (real adapters under a deny-external-network transport). Root owns browser QA and screenshots.

## Release verification and remaining limits
- Root browser review and independent diff review passed. Desktop/mobile screenshots and dimensions are in `docs/qa/2026-10-02/browser-qa.json`.
- Root deployed the candidate image on AWS with an image-only update; environment, mounts, network, budgets and 25 usage rows were preserved. Receipt: `docs/qa/2026-10-02/aws-release.json`.
- Original live grader failure remains unidentified: five uncertain Gemini calls, configured key present, allowance not exhausted, no retained upstream status. Never claim it was caused by missing key or additionalProperties.
- No real-provider calls or acceptance in this task. Fixture scores do not establish provider grading quality, account access or charges.
- Residual risks: cross-tab duplicate calls, per-process concurrency in multi-replica deployments, lost in-flight responses, no cloud comparison sync, and unrecoverable historical diagnostic details. Future grading failures now emit safe structured server events with a matching user support ID.

## Decisions
- 2026-10-02: explicit user choice authorizes transient user-key server proxying; no shared Gemini fallback or new key store.
- 2026-10-02: fixed provider origins/model presets; no custom endpoint, auto retry, fallback or paid key-validation request.
- 2026-10-02: use existing README as product brief; current full scan is explicitly authorized. Future automation/paid work is not enabled.
