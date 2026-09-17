# Model Arena

Compare up to three small Hugging Face models on the same prompts, with your own system prompt and an optional reference corpus, then have Gemini grade every answer. Built for exploring which small model fits a task before paying for a large one.

## What it does

- **Models**: pick up to three model ids served by the Hugging Face Inference router. The list is fetched live and small instruct models are suggested.
- **System prompt and corpus**: edit the system prompt; paste or upload a reference corpus and choose whether it goes into the user message as a supplied reference or is appended to the system prompt.
- **Prompts**: add prompts by hand, load samples, or upload a JSON file. Each prompt may carry a reference answer for the grader.
- **Run**: every prompt goes to every selected model with identical settings, three calls at a time, with automatic retries on rate limits.
- **Grade**: a Gemini model scores each answer 1 to 10 on accuracy, helpfulness and format, names the best answer, and gives a one-sentence reason. Answers are shuffled and anonymised before grading.
- **Summary and export**: per-model averages and wins; export everything as JSON or CSV. Settings and results persist in the browser.

## Prompt file format

Either an array of strings, or an array of objects:

```json
[
  { "id": "q1", "prompt": "Which is the best Avengers movie and why?" },
  { "id": "q2", "prompt": "Who directed Inception (2010)?", "reference": "Christopher Nolan" }
]
```

Accepted field names: `prompt`, `question`, `input`, `text` for the prompt; `reference`, `reference_answer`, `answer`, `expected` for the reference.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

Environment variables, all server-side:

| Variable | Purpose |
|---|---|
| `HF_TOKEN` | Hugging Face token with Inference Providers access |
| `GEMINI_API_KEY` | Google AI Studio key for the grader |
| `APP_ACCESS_KEY` | Optional. If set, the page asks for it once and sends it as a header on every API call. Set it on any public deployment, or anyone with the URL can spend your quota. |

## Deploy to Vercel

```bash
npx vercel env add HF_TOKEN production
npx vercel env add GEMINI_API_KEY production
npx vercel env add APP_ACCESS_KEY production
npx vercel --prod
```

## Notes

- Model availability and speed depend on the provider behind each id on the router; a 429 "model busy" is retried four times with backoff.
- Grading costs Gemini tokens: the grader reads the system prompt, up to 30,000 characters of the corpus, the prompt, the reference and every answer.
- Temperature 0 makes runs repeatable, which is what you want when comparing models.
