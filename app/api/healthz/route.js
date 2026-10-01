import { query } from "@/lib/db";
import { json, route } from "@/lib/http";
import { authSecret, origin } from "@/lib/security";
export const dynamic = "force-dynamic";
export const GET = route(async () => { authSecret(); origin(); await query("SELECT 1"); return json({ ok: true, auth: true, mock: process.env.MODEL_ARENA_MOCK_MODE === "1" }); });
