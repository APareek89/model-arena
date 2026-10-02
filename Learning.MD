# Model Arena — implementation evidence

## 2026-10-02 — grader diagnosis and BYOK configuration

A completed generation row can fail independently at grading. The old UI hid the grading reason in a title tooltip. Show a complete row-level error and repair action, preserve model answers, and separate run-error counts from grading failures. Browser review also showed that long error details inside the narrow prompt cell created tall empty rows; move detail outside the horizontally scrolling answer table, label it with its prompt, and link to it from the row. A colspan row still clipped text on mobile.

The historical five Gemini attempts are uncertain with null usage and no retained upstream diagnostic status. The deployed key existed and account budget remained available. The original reason is unknown. Do not infer missing credentials, quota, schema rejection, or provider outage from a generic failure.

Different structured-output APIs require different request shapes. OpenAI strict JSON Schema needs `additionalProperties:false`; Gemini's legacy `responseSchema` is an API message with documented uppercase types and a smaller field set. Use a dedicated projection, verified against Google's public discovery document. The deployed old schema did not have additionalProperties; preventing this new integration mismatch does not establish the old failure's cause. Claude uses the current `output_config.format` schema shape.

Missing terminal status, refusals, truncated output, missing scores and malformed entries must fail closed instead of displaying a completed grade. HTTP failures may contain HTML or sensitive raw text; preserve only safe status/action guidance and handle status before trying JSON. Never automatically retry a billable request.

User keys belong only in React memory and transient request headers. Fixed provider origins prevent credential-bearing SSRF. Do not use the hosted allowance ledger for user-paid grading or call an unknown cost zero. Changing a key/provider must not discard generated answers.

Imported prompt/reference objects or numbers previously underwent String coercion. Require text. Reject row-ID delimiters/control characters so prefix invalidation cannot target another row. Keep blank draft support and CSV formula neutralization.

Independent review reproduced a PostgreSQL TLS override: the installed pg parser honors `?ssl=no-verify` even when an explicit verifying CA object is supplied. Removing only four known URL options was insufficient. Strip the entire case-insensitive ssl option namespace and assert the constructed client's final TLS settings without connecting.

## Evidence limits

Eight independent active-session proxy judgments cover 18 answers, projected through all three actual adapters and normal local HTTP routes. They test transport, validation and anonymous label mapping; they are not real provider evaluations. Network-denying fixtures and a local `_test` PostgreSQL database keep this phase free. Full tests/build/HTTP receipts and the 122-scenario matrix are under `docs/qa/2026-10-02/`. Production load, actual billing and real model acceptance remain outside this proof.

Root requested prevention of future undiagnosable failures: grading now logs only a fixed event, random support ID, allowlisted provider/model, bounded upstream status and category. The matching ID appears in the API/client error. Never serialize the request or Error object; raw messages/stacks can contain credentials or content. Tests inject sensitive strings and prove they are absent.

FileReader callbacks can complete out of order or after a user edits/clears the input. Per-input generation gates ensure the latest file wins, while manual edits, new examples and Run/Grade invalidate pending callbacks. Separate corpus and prompt imports can still complete independently. Tests simulate reversed completion and invalidation; source review confirms manual edit, clear, example and Run/Grade actions call that boundary.

Valid JSON is not a valid workspace: stored object-valued text/reasons or token counts previously reached React and could crash the page. Restoration now allowlists fields, validates score components, recomputes overall, strips unknown fields and replaces unsafe records with explicit recoverable errors while retaining valid neighboring results. This also prevents an unexpected persisted credential field from being adopted.
