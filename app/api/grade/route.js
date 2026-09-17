import { requireKey, missingEnv } from "@/lib/auth";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SCHEMA = {
  type: "object",
  properties: {
    scores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          accuracy: { type: "integer" },
          helpfulness: { type: "integer" },
          format: { type: "integer" },
          reason: { type: "string" },
        },
        required: ["label", "accuracy", "helpfulness", "format", "reason"],
      },
    },
    best: { type: "string" },
  },
  required: ["scores", "best"],
};

const LABELS = "ABCDEF";

export async function POST(req) {
  const denied = requireKey(req); if (denied) return denied;
  const missing = missingEnv(["GEMINI_API_KEY"]); if (missing) return missing;
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const { grader = "gemini-3.1-pro-preview", prompt, reference = "", corpus = "", systemPrompt = "", responses = [] } = body || {};
  if (!prompt || !Array.isArray(responses) || responses.length < 1) return Response.json({ error: "prompt and responses are required" }, { status: 400 });
  if (!/^[a-z0-9.\-]+$/i.test(grader)) return Response.json({ error: "Invalid grader model name" }, { status: 400 });

  const order = responses.map((_, i) => i).sort(() => Math.random() - 0.5);
  const shown = order.map((idx, k) => ({ label: LABELS[k], model: responses[idx].model, text: String(responses[idx].text ?? "") }));
  const corpusText = corpus ? String(corpus).slice(0, 30000) : "";

  const instructions = [
    "You are a strict, fair grader comparing answers from different language models to the same prompt.",
    "Score every answer independently on three criteria, each an integer from 1 (very poor) to 10 (excellent):",
    "- accuracy: factual correctness; when a reference answer or reference corpus is supplied, correctness means agreement with it and never inventing facts beyond it.",
    "- helpfulness: does it actually answer the question with specific, useful reasoning at an appropriate length.",
    "- format: does it follow the instructions in the system prompt and the question, including requested structure and length; penalise repetition, cut-off answers and filler.",
    "Then name the best answer by its label. Judge the content, not the label order. Give a one-sentence reason per answer.",
  ].join("\n");

  const parts = [];
  if (systemPrompt) parts.push(`SYSTEM PROMPT GIVEN TO THE MODELS:\n${systemPrompt}`);
  if (corpusText) parts.push(`REFERENCE CORPUS SUPPLIED TO THE MODELS (answers must be grounded in this):\n${corpusText}`);
  parts.push(`QUESTION:\n${prompt}`);
  if (reference) parts.push(`REFERENCE ANSWER (ground truth for accuracy):\n${reference}`);
  parts.push(shown.map((s) => `ANSWER ${s.label}:\n${s.text || "(empty answer)"}`).join("\n\n"));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${grader}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const started = Date.now();
  const r = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: instructions }] },
      contents: [{ parts: [{ text: parts.join("\n\n") }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0 },
    }),
  });
  const raw = await r.text();
  let j = null; try { j = JSON.parse(raw); } catch {}
  if (!r.ok) return Response.json({ error: j?.error?.message || raw.slice(0, 300) || `Gemini ${r.status}` }, { status: 502 });
  const text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  let parsed;
  try { parsed = JSON.parse(text); } catch { return Response.json({ error: "Grader returned non-JSON output", raw: text.slice(0, 500) }, { status: 502 }); }

  const byLabel = Object.fromEntries(shown.map((s) => [s.label, s.model]));
  const scores = {};
  for (const s of parsed.scores || []) {
    const model = byLabel[s.label]; if (!model) continue;
    const acc = clamp(s.accuracy), help = clamp(s.helpfulness), fmt = clamp(s.format);
    scores[model] = { accuracy: acc, helpfulness: help, format: fmt, overall: Math.round(((acc + help + fmt) / 3) * 10) / 10, reason: String(s.reason || "") };
  }
  const best = byLabel[parsed.best] || null;
  const ranking = Object.entries(scores).sort((a, b) => b[1].overall - a[1].overall).map(([m]) => m);
  return Response.json({ grader, scores, best, ranking, ms: Date.now() - started, usage: j.usageMetadata || null });
}

function clamp(v) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : 1; }
