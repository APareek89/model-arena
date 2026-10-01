import { requireActor } from "@/lib/auth";
import { userLimit } from "@/lib/security";
import { modelCatalog } from "@/lib/catalog";
import { json, route } from "@/lib/http";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const GET = route(async req => { const actor = await requireActor(req); await userLimit(actor, "models", 120, 3600); return json(await modelCatalog()); });
