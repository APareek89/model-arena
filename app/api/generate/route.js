import { requireKey, missingEnv } from "@/lib/auth";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function POST(req) {
  const denied = requireKey(req); if (denied) return denied;
  const missing = missingEnv(["HF_TOKEN"]); if (missing) return missing;
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const { model, messages, max_tokens = 300, temperature = 0 } = body || {};
  if (!model || !Array.isArray(messages) || !messages.length) return Response.json({ error: "model and messages are required" }, { status: 400 });
  const started = Date.now();
  let lastError = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    let r;
    try {
      r = await fetch("https://router.huggingface.co/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.HF_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, max_tokens: Math.min(Math.max(1, +max_tokens || 300), 2048), temperature: Math.min(Math.max(0, +temperature || 0), 2), stream: false }),
        cache: "no-store",
      });
    } catch (e) {
      lastError = `Network error: ${e.message}`; await sleep(800 * 2 ** attempt); continue;
    }
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    const choice = j?.choices?.[0];
    if (r.ok && choice) {
      return Response.json({
        text: choice.message?.content ?? "",
        finish: choice.finish_reason || null,
        usage: j.usage || null,
        servedModel: j.model || model,
        ms: Date.now() - started,
        attempts: attempt + 1,
      });
    }
    lastError = j?.error?.message || j?.error || text.slice(0, 300) || `HTTP ${r.status}`;
    if (r.status === 429 || r.status >= 500) { await sleep(800 * 2 ** attempt); continue; }
    return Response.json({ error: String(lastError), status: r.status }, { status: 502 });
  }
  return Response.json({ error: `Gave up after 4 attempts: ${lastError}` }, { status: 503 });
}
