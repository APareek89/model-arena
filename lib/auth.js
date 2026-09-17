export function requireKey(req) {
  const expected = process.env.APP_ACCESS_KEY;
  if (!expected) return null;
  const got = req.headers.get("x-app-key") || "";
  if (got !== expected) return Response.json({ error: "Access key required" }, { status: 401 });
  return null;
}

export function missingEnv(names) {
  const missing = names.filter((n) => !process.env[n]);
  return missing.length ? Response.json({ error: `Server is missing ${missing.join(", ")}` }, { status: 500 }) : null;
}
