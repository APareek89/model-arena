# Model Arena request flow

The browser stores comparison content by account. It keeps the grader key only in memory. The server authenticates every provider request and uses a fixed upstream destination. HF generation reserves hosted funds; user-key grading does not. Both paths are bounded and make one upstream attempt.

```mermaid
flowchart TD
  UI["Compare / Configure [FUNCTION]<br/>in: prompts, models, session key<br/>out: explicit Run or Grade request"]:::fn
  AUTH["Auth + CSRF + rate gate [FUNCTION]<br/>in: cookie and request<br/>out: authorized owner or error"]:::fn
  EX{"Prepared example? [FUNCTION]<br/>in: example identifier<br/>out: branch"}:::dec
  FIX["Canonical fixture [DATA · bundled example]<br/>in: example and prompt IDs<br/>out: prepared answer/grade, no provider"]:::data
  KIND{"Run or Grade? [FUNCTION]<br/>in: route<br/>out: branch"}:::dec
  RES["HF reservation [FUNCTION]<br/>in: priced pinned route and owner budget<br/>out: durable reservation or rejection"]:::fn
  HF["Generate [AGENT · selected HF instruct model]<br/>in: system and user context<br/>out: text, stop reason, usage"]:::agent
  SET["Settle HF usage [FUNCTION]<br/>in: reservation and provider usage<br/>out: complete or uncertain ledger row"]:::fn
  CRED["BYOK validation [FUNCTION]<br/>in: allowlisted provider/model and transient key<br/>out: validated selection or error"]:::fn
  ANON["Shuffle and anonymize [FUNCTION]<br/>in: up to3 answers plus rubric/context<br/>out: labels and provider-specific request"]:::fn
  JUDGE["Judge [AGENT · chosen Gemini / OpenAI / Claude preset]<br/>in: anonymous request and transient key header<br/>out: score JSON, completion status, usage"]:::agent
  PARSE["Validate and map [FUNCTION]<br/>in: terminal status and all score labels<br/>out:1–10 scores mapped to model IDs or error"]:::fn
  OUT["Render and export [FUNCTION]<br/>in: answers, scores or safe errors<br/>out: preserved comparison; keys excluded"]:::term
  UI --> AUTH --> EX
  EX -->|yes| FIX --> OUT
  EX -->|no| KIND
  KIND -->|Run| RES --> HF --> SET --> OUT
  KIND -->|Grade| CRED --> ANON --> JUDGE --> PARSE --> OUT
  classDef agent fill:#dbeafe,stroke:#2563eb,color:#0b2a5b;
  classDef fn fill:#dcfce7,stroke:#16a34a,color:#052e16;
  classDef dec fill:#f3e8ff,stroke:#9333ea,color:#2a0a4a;
  classDef term fill:#e5e7eb,stroke:#6b7280,color:#111827;
  classDef ask fill:#cffafe,stroke:#0891b2,color:#083344;
  classDef data fill:#ede9fe,stroke:#7c3aed,color:#2a0a4a;
```

The green boxes are deterministic functions, blue boxes are actual provider model calls, purple boxes are data, diamonds choose paths, and gray is the user-visible result. In local fixture QA the blue steps are intercepted outside application code; no real model is called.

Gates: server requires auth and session CSRF; grade rate90/hour; provider capacity3/owner and6/process; output cap2048tokens; provider response1MiB; timeout45seconds; anonymous answers1–3; prompt/reference8k, system20k, corpus30k characters. Model Arena does not retry or fall back automatically.

File index: UI and persistence `app/page.js`; session ownership `app/client/session.mjs`; public presets `app/client/grader.mjs`; auth `lib/auth.js`; shared rubric and scoring `lib/providers.js`; provider-specific wires `lib/grader-provider.js`; bounded transport `lib/provider-http.js`; hosted budget `lib/usage.js`; PostgreSQL `lib/db.js`.
