import { requireActor } from "@/lib/auth";
import { EXAMPLE } from "@/lib/examples";
import { json, route } from "@/lib/http";
export const dynamic = "force-dynamic";
export const GET = route(async req => { await requireActor(req); return json(EXAMPLE); });
