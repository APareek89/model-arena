import { HttpError } from "./http.js";

export async function providerJson(url, init = {}, { timeout = 45000, maximum = 1024 * 1024 } = {}) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeout);
  let reader, upstreamStatus;
  try {
    const response = await fetch(url, { ...init, redirect: "error", cache: "no-store", signal: abort.signal });
    upstreamStatus = response.status;
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
    if (!response.ok) {
      const guidance = response.status === 401 || response.status === 403 ? ' Check the API key and model access in Configure.'
        : response.status === 429 ? ' The provider rate or quota limit was reached; check its billing and limits before retrying.'
        : response.status === 404 ? ' This model is unavailable to your provider account; choose another model in Configure.'
        : response.status === 400 ? ' The provider rejected these inputs; review the comparison or choose another model.' : '';
      throw new HttpError(502, `The provider could not complete this request (HTTP ${response.status}).${guidance} No automatic retry was made.`, { category: 'upstream_http', upstreamStatus });
    }
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new HttpError(502, "Provider returned an unreadable response."); }
    return data;
  } catch (error) {
    if (error instanceof HttpError) { error.upstreamStatus ??= upstreamStatus; error.category ??= 'invalid_response'; throw error; }
    throw new HttpError(502, "The provider request could not complete. No automatic retry was made.", { category: abort.signal.aborted ? 'timeout' : 'network', upstreamStatus });
  } finally { clearTimeout(timer); if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); } }
}
