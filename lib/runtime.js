const loopback = value => ["localhost", "127.0.0.1", "::1", "[::1]"].includes(value);

export function localPreview() {
  if (process.env.MODEL_ARENA_LOCAL_PREVIEW !== "1") return false;
  const address = new URL(process.env.PUBLIC_ORIGIN || "");
  const database = new URL(process.env.DATABASE_URL || "");
  if (address.origin !== process.env.PUBLIC_ORIGIN || address.protocol !== "http:" || !loopback(address.hostname) || !loopback(database.hostname) || process.env.MODEL_ARENA_MOCK_MODE !== "1" || process.env.MODEL_ARENA_BIND_HOST !== "127.0.0.1" || process.env.HF_TOKEN || process.env.GEMINI_API_KEY) throw new Error("The local preview must be loopback-only with synthetic providers.");
  return true;
}
