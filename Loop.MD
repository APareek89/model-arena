# Model Arena — bounded free verification loop

Status: REVIEW_READY after automated checks; root browser/review acceptance pending. No recurring automation enabled.

## Product gates
- Up to three HF models, 30 prompts, reference/system context and stable anonymous score mapping.
- Prepared example always bypasses providers; editing marks a live comparison.
- Configure supports Gemini, OpenAI, Claude with memory-only key. No key persistence, export, logging, shared-key fallback or automatic paid validation.
- All write routes require normal auth/CSRF. BYOK stays outside hosted allowance, price unknown.
- Grading errors preserve answers and remain readable; truncation is explicit; no automatic provider retry.

## Free commands
1. `MODEL_ARENA_TEST_ENV=/absolute/private/model-arena-test-env.json npm test`
2. `npm run test:client`
3. `MODEL_ARENA_DIST_DIR=.next-fmea-build NEXT_TELEMETRY_DISABLED=1 npm run build`
4. `MODEL_ARENA_TEST_ENV=/absolute/private/model-arena-test-env.json MODEL_ARENA_FIXTURE_AUDIT=/absolute/external/arena-wire-network.jsonl node scripts/qa-server.mjs`
5. `MODEL_ARENA_QA_RECEIPT=docs/qa/2026-10-02/http-results.json node scripts/qa-http.mjs`

The server script requires loopback `_test` PostgreSQL, denies external DNS/sockets/fetch, and accepts only the synthetic fixture key. Root uses the built-in browser for mobile/desktop/auth/tab/error/key-lifetime acceptance. Do not alter a running baseline build directory; use MODEL_ARENA_DIST_DIR.

## Stop conditions
No paid calls, real credentials, deploy, commit or push by this worker. Tests do not authorize those steps. If the fixture transport rejects an unrecognized request, fix the fixture/contract rather than allowing network. Exact original grader failure and actual provider quality remain unverified until a separately authorized live phase.
