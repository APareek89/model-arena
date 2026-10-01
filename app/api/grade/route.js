import { requireActor } from "@/lib/auth";
import { userLimit } from "@/lib/security";
import { json, readJson, route } from "@/lib/http";
import { grade } from "@/lib/providers";
import { preparedGrade } from "@/lib/examples";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const POST = route(async req => {
  const actor = await requireActor(req, { write: true });
  await userLimit(actor, "grade", 90, 3600);
  const body = await readJson(req);
  return json(body.example_id ? preparedGrade(body) : await grade(actor, body));
});
