import { handlers } from "@/lib/auth";
import { checkOrigin } from "@/lib/security";
import { readBytes, route } from "@/lib/http";
import { NextRequest } from "next/server";
export const dynamic = "force-dynamic";
export const GET = handlers.GET;
export const POST = route(async req => {
  checkOrigin(req);
  const body = await readBytes(req, 8192);
  return handlers.POST(new NextRequest(req.url, { method: "POST", headers: req.headers, body }));
});
