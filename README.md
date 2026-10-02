# Model Arena

Compare up to three Hugging Face models on the same prompts and reference material, then inspect scores from your chosen Gemini, OpenAI or Claude grader. Model Arena keeps the original side-by-side workflow: individual or batch runs, stop after current calls, anonymized grading, per-model averages, and JSON/CSV exports.

**Live on AWS:** [Model Arena](https://model-arena.3-6-183-210.sslip.io). Email/password accounts, the prepared comparison workflow and one paid Hugging Face generation are verified. The app is running in ordinary live mode; the unchanged prepared example stays free.

## Try it in three steps

1. Open the app and create an email/password account. Your comparisons are saved in this browser under your account.
2. Choose **Try with an example**, then **Run all** and **Grade all**. The movie example uses prepared answers and illustrative scores; these actions make no provider calls while the example remains unchanged.
3. Inspect each answer, score and reason, compare the summary, and export JSON or CSV. Editing the example switches to a live comparison and clears affected results or grades.

The prepared prompts cover a subjective Avengers-film choice, a romantic-film recommendation with three reasons and one caveat, and the director of Inception with a reference answer. Prepared scores are a workflow demonstration, not a model benchmark.

## Use your own inputs

Choose up to three model IDs, edit the system prompt and optionally paste or upload a reference corpus. The corpus can be sent in the user message or appended to the system prompt. Add prompts by hand, load the original samples, or upload JSON. Each prompt may include a reference answer for grading.

```json
[
  { "id": "q1", "prompt": "Which is the best Avengers movie and why?" },
  { "id": "q2", "prompt": "Who directed Inception (2010)?", "reference": "Christopher Nolan" }
]
```

String arrays and an object containing a `prompts` array are also accepted. Prompt aliases are `question`, `input`, `text` and `user`; reference aliases are `reference_answer`, `answer` and `expected`. IDs must be unique text of at most 80 characters, without control characters or the | separator. Prompt and reference values must be strings.

Limits are 30 prompts, 8,000 characters per prompt/reference, 20,000 for the system prompt, 30,000 for the corpus and 2 MiB per imported file. Imports remain in browser memory/account-scoped browser storage; they are not uploaded to an object store. Running or grading sends the relevant text to the selected providers.

## Live comparisons and limits

Live **Run** sends every selected prompt to each selected HF model and uses the hosted allowance. **Grade** makes a separate call per complete row using the provider, model and API key entered in Configure; your provider bills that call directly. Suggestions show HF models with current verified route prices. Unknown-price generation routes fail closed. A listed model is not a guarantee of provider availability or account access.

Answers are shuffled and anonymized before grading. Accuracy, helpfulness and format are each scored from 1 to 10. These are model judgments, not proof of factual correctness. Lower temperature reduces variation but does not guarantee identical output. Stopping prevents new queued generation calls; already-dispatched calls may still complete.

Browser state is separated by verified account ID and clears from the active screen on sign-out or account change. The legacy global workspace is not imported into any account. Its retired shared access key is removed without adopting the unowned prompts/results. Comparisons are not synchronized across devices; export before clearing browser data or using a shared device. Email verification, Google sign-in and email password recovery are not configured. There is no generated-media pipeline.

## Verification scope

On 1 October 2026, live checks passed account isolation, CSRF, session revocation, six prepared answers, three illustrative grades and preserved user records over verified PostgreSQL TLS. Browser review covered sign-in, example Run/Grade, summary, reload, theme switching and export buttons. The identical local production build also passed 390px layout and same-browser account switching.

One controlled normal generation used `Qwen/Qwen3-4B-Instruct-2507:nscale`, a 64-token cap and temperature 0. It answered the Inception director question with “Christopher Nolan”: one HTTP 200, one provider dispatch and one completed usage row, with 19 input and 3 output tokens. Estimated cost was **USD 0.00000028**, based on the selected route’s published catalog rates, not an invoice. No cache or reasoning tokens were reported. Grading at that launch was verified with prepared/mock responses; no paid Gemini grade or full paid comparison matrix was run. These checks demonstrate workflow and accounting, not model benchmark quality.

## Development and deployment

Use Node 24 and `npm ci`. Local integration requires a separate PostgreSQL database even in mock mode; authentication is not bypassed. Configure private environment values using the server settings in [deployment notes](docs/PORTFOLIO-DEPLOYMENT.md), with provider keys absent and `MODEL_ARENA_MOCK_MODE=1` during development.

```bash
npm ci
npm run test:client
MODEL_ARENA_DIST_DIR=.next-integrated npm run build
```

The separate build directory preserves an accepted baseline preview. Run backend tests only with their isolated fixture environment; never point tests at the production database. The historical Vercel script is not the AWS deployment workflow.

See [the launch review](docs/FMEA-PORTFOLIO.md) for the historical launch verification scope, and the dated FMEA report below for current changes and limits. No real provider call is part of an ordinary development test.


### Grader configuration (2026-10-02)

Open **Configure**, choose Gemini, OpenAI or Claude, select a supported model, and paste your own API key. The key remains in page memory only; reload, sign-out, or changing provider clears it. It is sent through the authenticated server only for an explicit Grade request. It is not written to browser storage, exports, logs, or the database. Key entry does not verify account access or call a provider. The prepared example works without a key.

Grading uses your provider account and is billed separately from the hosted Hugging Face allowance. The app does not estimate BYOK dollar cost. Completed answers remain available after grading failures or changing grader configuration. The UI shows safe provider-status guidance and never automatically retries. Model presets are capability-checked request formats, not a guarantee that your account has access.

The earlier deployment notes about a shared Gemini key/catalog are historical. The active `/api/grade` route requires a request-supplied key and never falls back to `GEMINI_API_KEY`. No new service, database schema, or secret store is introduced.

The complete free QA record is in [the FMEA report](docs/qa/2026-10-02/report.md), with 122 possible failure scenarios across all 12 categories and separate executed-test/source-review/simulation/not-run evidence. Live acceptance remains unverified until separately authorized provider calls are completed.
