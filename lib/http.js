export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function json(value, status = 200, headers = {}) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function route(handler) {
  return async (...args) => {
    try { return await handler(...args); }
    catch (error) {
      return json({ error: error instanceof HttpError ? error.message : "The service could not complete this request. Please try again later." }, error instanceof HttpError ? error.status : 503);
    }
  };
}

export async function readBytes(req, maximum = 512 * 1024) {
  if (Number(req.headers.get("content-length") || 0) > maximum) throw new HttpError(413, "Request is too large.");
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "A JSON body is required.");
  let size = 0; const chunks = [];
  const deadline = Date.now() + 10000;
  try {
    while (true) {
      let timer;
      const { value, done } = await Promise.race([reader.read(), new Promise((_, reject) => { timer = setTimeout(() => reject(new HttpError(408, "Request body timed out.")), Math.max(1, deadline - Date.now())); })]).finally(() => clearTimeout(timer));
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new HttpError(413, "Request is too large."); }
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export async function readJson(req, maximum = 512 * 1024) {
  if (!(req.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) throw new HttpError(415, "Use a JSON request body.");
  const content = await readBytes(req, maximum);
  try {
    const value = JSON.parse(content.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new HttpError(400, "Invalid JSON body."); }
}

export function text(value, name, maximum, { optional = false } = {}) {
  if (optional && value == null) return "";
  if (typeof value !== "string" || value.length > maximum || (!optional && !value.trim())) throw new HttpError(400, `${name} must be ${optional ? "text up to" : "non-empty text up to"} ${maximum.toLocaleString()} characters.`);
  return value;
}
