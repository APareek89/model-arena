import { requireActor } from "@/lib/auth";
import { userLimit } from "@/lib/security";
import { json, readJson, route } from "@/lib/http";
import { generate } from "@/lib/providers";
import { preparedGeneration } from "@/lib/examples";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const POST = route(async req => {
  const actor = await requireActor(req, { write: true });
  await userLimit(actor, "generate", 180, 3600);
  const body = await readJson(req);
  return json(body.example_id ? preparedGeneration(body) : await generate(actor, body));
});
