import { requireKey, missingEnv } from "@/lib/auth";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

let cache = { at: 0, data: null };

function isSmall(id) {
  if (/A\d+(\.\d+)?B/i.test(id)) return false;
  const m = id.match(/(\d+(?:\.\d+)?)B/i);
  if (!m) return false;
  return parseFloat(m[1]) <= 9;
}

export async function GET(req) {
  const denied = requireKey(req); if (denied) return denied;
  const missing = missingEnv(["HF_TOKEN"]); if (missing) return missing;
  if (cache.data && Date.now() - cache.at < 10 * 60 * 1000) return Response.json(cache.data);
  const r = await fetch("https://router.huggingface.co/v1/models", {
    headers: { Authorization: `Bearer ${process.env.HF_TOKEN}` }, cache: "no-store",
  });
  if (!r.ok) return Response.json({ error: `Hugging Face router answered ${r.status}` }, { status: 502 });
  const j = await r.json();
  const models = (j.data || []).map((m) => m.id).sort((a, b) => a.localeCompare(b)).map((id) => ({ id, small: isSmall(id) }));
  cache = { at: Date.now(), data: { models, fetchedAt: new Date().toISOString() } };
  return Response.json(cache.data);
}
