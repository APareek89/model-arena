import { requireActor } from "@/lib/auth";
import { userLimit } from "@/lib/security";
import { GRADER_PROVIDERS } from "@/app/client/grader.mjs";
import { json, route } from "@/lib/http";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const GET = route(async req => { const actor = await requireActor(req); await userLimit(actor, "graders", 120, 3600); return json({ providers: GRADER_PROVIDERS, mode: 'user_key', default: 'gemini-2.5-flash-lite', models: GRADER_PROVIDERS[0].models }); });
