import { requireActor } from "@/lib/auth";
import { mockMode } from "@/lib/catalog";
import { json, route } from "@/lib/http";
export const dynamic = "force-dynamic";
export const GET = route(async req => {
  await requireActor(req);
  return json({ needsKey: true, auth: true, hf: mockMode() || Boolean(process.env.HF_TOKEN), graderMode: 'user_key', providerMode: mockMode() ? "mock" : "live", defaultGrader: "gemini-2.5-flash-lite", preparedExamples: true });
});
