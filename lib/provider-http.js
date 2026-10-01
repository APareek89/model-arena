import { HttpError } from "./http.js";

export async function providerJson(url, init = {}, { timeout = 45000, maximum = 1024 * 1024 } = {}) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeout);
  let reader;
  try {
    const response = await fetch(url, { ...init, redirect: "error", cache: "no-store", signal: abort.signal });
    if (Number(response.headers.get("content-length") || 0) > maximum) throw new HttpError(502, "Provider response exceeded the size limit.");
    reader = response.body?.getReader();
    if (!reader) throw new HttpError(502, "Provider returned an empty response.");
    const chunks = []; let size = 0;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maximum) { abort.abort(); throw new HttpError(502, "Provider response exceeded the size limit."); }
      chunks.push(Buffer.from(value));
    }
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new HttpError(502, "Provider returned an unreadable response."); }
    if (!response.ok) throw new HttpError(502, `The provider could not complete this request (HTTP ${response.status}). No automatic retry was made.`);
    return data;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, "The provider request could not complete. No automatic retry was made.");
  } finally { clearTimeout(timer); if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); } }
}
