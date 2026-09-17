import { requireKey, missingEnv } from "@/lib/auth";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const EXCLUDE = /tts|image|transcribe|robotics|computer-use|omni|embedding|aqa/i;

export async function GET(req) {
  const denied = requireKey(req); if (denied) return denied;
  const missing = missingEnv(["GEMINI_API_KEY"]); if (missing) return missing;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=100&key=${process.env.GEMINI_API_KEY}`, { cache: "no-store" });
  if (!r.ok) return Response.json({ error: `Gemini answered ${r.status}` }, { status: 502 });
  const j = await r.json();
  const models = (j.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((n) => n.startsWith("gemini") && !EXCLUDE.test(n))
    .sort((a, b) => score(b) - score(a) || a.localeCompare(b));
  return Response.json({ models });
}

function score(name) {
  const v = parseFloat((name.match(/gemini-(\d+(?:\.\d+)?)/) || [0, "0"])[1]);
  return v * 10 + (/pro/.test(name) ? 5 : 0) + (/latest/.test(name) ? 1 : 0);
}
