# Model Arena — free FMEA and grader configuration QA

The app now has a Configure tab for Gemini, OpenAI and Claude, with capability-specific model presets and a user-supplied key. The key exists only in page memory and transient server request/header handling. It is not saved, exported, logged, hashed, or put into the usage ledger. Switching provider clears it; reloading or signing out removes the workspace component. Model/provider edits retain generation results and invalidate grades only.

BYOK grading is billed directly by the selected provider, outside the hosted generation allowance. Returned price is explicitly unknown (`costUSD:null`), not free. Auth, CSRF, rate limits, concurrency, fixed endpoints, bounded bodies, a 45-second timeout and 2,048 output-token limit remain enforced. Entering/configuring a key does not call a provider. Only an explicit Grade action does. Prepared examples need no key.

## Original incident: established facts and limits

The screenshot showed successful generation with a grader failure whose explanation was hidden behind a hover title. Root's independent read-only live audit found 20 completed HF requests and 5 Gemini grading attempts with `uncertain` status and null token/cost details. The configured shared Gemini key was present, and the affected account remained below its allowance. Missing key and exhausted hosted allowance are therefore ruled out for that incident.

The deployed Gemini request used `responseSchema`, lowercase schema type names, `thinkingBudget:0`, and a 2,048 output limit. It did **not** include `additionalProperties`. No safe upstream status/body was retained, so the precise historical provider rejection cannot be recovered from these records. This report does not label any hypothesis as the historical cause. No real-provider acceptance has been demonstrated in this task.

Google's public v1beta discovery document uses uppercase legacy type enums and excludes `additionalProperties` from its legacy `Schema` message. The new Gemini adapter projects the common schema into that documented form. OpenAI and Claude retain ordinary JSON Schema with `additionalProperties:false`. This prevents a new cross-provider compatibility defect caught during review; it is not evidence that OpenAI-only fields caused the original incident.

## Verified corrections

- Expose full actionable grading errors and a Configure action while preserving generated answers. Error detail occupies a container-width block outside the horizontally scrolling table, labeled by prompt and linked from its row. The summary separates run errors from grading failures.
- Keep error notifications visible until dismissed rather than automatically losing them after 6 seconds.
- Reject malformed/null score entries, missing completion status, truncated grade responses, provider refusals and invalid output schemas; no invented replacement grades.
- Handle upstream non-2xx status before parsing an HTML/text error body. Retain safe status/action guidance without exposing raw provider content or credentials.
- Add safe structured failure telemetry with a random support reference, allowlisted provider/model, bounded upstream HTTP status and category; never include key, prompt, request body, raw error message or stack. The visible reference matches the server event. Historical logs cannot be reconstructed.
- Give each upload input a generation gate so an older FileReader completion cannot overwrite a newer file or subsequent manual edit/clear/run/example.
- Reject non-text imported prompts/references and unsafe/delimiter-containing prompt IDs instead of silently coercing input or invalidating another row.
- Validate persisted result/grade records before restoring them. Object-valued text/reasons, invalid scores and unknown fields become a recoverable per-item error or are safely omitted; valid neighboring answers remain.
- Explain generation truncation as a partial answer and its effect on subsequent grading.
- Strip every case-insensitive `ssl` URL option before constructing PostgreSQL connections, so `ssl=no-verify` cannot override the explicitly verified CA settings; tested against the installed pg parser without connecting.
- Remove the server-key/catalog dependency from the grading route; no shared-key fallback. HF generation remains under the hosted budget.

## Evidence and reproducibility

`fmea.csv` and `fmea.json` enumerate **122 distinct possible failure scenarios across all 12 categories**. They are not 122 observed defects. Each row contains S/O/D, RPN, priority, status, evidence method, code/test anchor and action/remaining limit. Fixed rows retain pre-mitigation scoring; controlled/risk rows describe current controls. Source inspection and scenario simulation do not establish production behavior.

Current status counts: **18 addressed scenario rows, 95 controlled, 5 residual risks, 2 product limits, 1 historical diagnostic limit and 1 unverified load case**. Evidence methods: 72 automated, 39 source inspections, 6 scenario simulations and 5 not run. These are scenario/evidence classifications, not counts of unique defects or proof that every scenario was executed. ARENA-101 is now controlled for this release because the AWS receipt confirms `mock:false` and `auth:true` on 2026-10-02; future deployments still require that check.

- `backend-tests.txt`: actual Node tests, including real isolated PostgreSQL owner/budget checks, intercepted provider transports, validation, timeout/refusal/truncation errors, and official Gemini schema conformance. See its final test count.
- `client-tests.txt`: actual Node client-state/import/CSV/key-selection/queue tests. See its final count.
- `http-results.json`: 37 normal local HTTP checks using signup, sign-in, cookie sessions and CSRF, including 24 comparisons through the three actual grader adapters. Provider wires are intercepted by a transport that denies external sockets/DNS. These are route proofs, not just mocks of `grade()`.
- `tests/fixtures/session-proxy.json`: eight independently judged cases from the active Codex session, covering 18 answers: factual correctness, subjective choice, requested format, missing corpus evidence, injected instructions, empty answers, Hindi and ties. The same judgments flow through all three providers' output formats. This verifies wire/schema/anonymous-label mapping; it **does not** measure real Gemini/OpenAI/Claude judging quality.
- `tests/fixtures/gemini-schema-contract.json`: dated public documentation excerpt; strict recursive schema checks use it.
- `build.txt`: isolated production build receipt, including Next's compilation/type-validity checks. This JS project has no separate TypeScript checker.
- `browser-qa.json` and `screenshots/`: committed root browser evidence at 1280px and 390px, covering all three provider configurations, provider-change/reload key clearing with answers retained, the readable401 error/support reference, no mobile document overflow, and light/dark contrast. All four screenshot hashes were verified against the receipt. These checks use intercepted provider transport, not real model calls.

Run free checks:

```sh
MODEL_ARENA_TEST_ENV=/absolute/private/model-arena-test-env.json npm test
npm run test:client
MODEL_ARENA_DIST_DIR=.next-fmea-build NEXT_TELEMETRY_DISABLED=1 npm run build
MODEL_ARENA_TEST_ENV=/absolute/private/model-arena-test-env.json MODEL_ARENA_FIXTURE_AUDIT=/absolute/external/arena-wire-network.jsonl node scripts/qa-server.mjs
MODEL_ARENA_QA_RECEIPT=docs/qa/2026-10-02/http-results.json node scripts/qa-http.mjs
```

The fixture server binds 127.0.0.1:8995, requires an isolated `_test` PostgreSQL database and uses only the literal `offline-fixture-key-only`. It runs the actual adapter path, so its normal app label says live comparison; the transport still prevents every external provider call. Do not use a real key. Synthetic UI failures: prompt `__FIXTURE_GRADE_401__`, malformed response `__FIXTURE_BAD_JSON__`, or generation token stop `__FIXTURE_TRUNCATE__`.

## Remaining limits

No paid calls, deployment, commit or push were performed by this worker. Real credentials, model availability, provider account permissions, provider grading quality, actual charges, production load and failure recovery are not certified by local fixtures. There is no custom-provider URL, cloud storage of keys, automatic retry/fallback, distributed concurrency lease, cross-tab idempotency or cloud workspace sync. An in-flight provider request can still be charged if a tab closes or its result is lost. Safe structured events now use existing server console collection; dashboards/alerts are not added, and the original missing diagnostic details cannot be reconstructed.

**Coverage: 12/12 categories checked.** The matrix records controls and residual risks in every category; it does not inflate their count into confirmed software bugs.

## Official request-format sources

- [Google public v1beta discovery](https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta) — exact `GenerateContentRequest`, legacy `Schema`, `GenerationConfig` and `ThinkingConfig` shapes; fetched 2026-10-02 without credentials.
- [Gemini generateContent API](https://ai.google.dev/api/generate-content) and [Gemini 2.5 Flash-Lite capabilities](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite).
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) and [GPT-4.1 Mini capabilities](https://developers.openai.com/api/docs/models/gpt-4.1-mini).
- [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) — `output_config.format` with JSON Schema and supported Haiku/Sonnet 4.5 family.

## Root release verification

Runtime checkpoint `8d96f62` is both the local HEAD and origin/main at this read-only release review. Root completed desktop/mobile and light/dark browser review; see `browser-qa.json` and its screenshot hashes. The tested code was deployed using a reversible image-only AWS update. Existing environment and runtime boundaries were identical before/after, and the usage ledger stayed at 25 rows. See `aws-release.json`. No paid acceptance was run; the explicit user confirmation boundary remains.
