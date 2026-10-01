import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { HttpError } from "./http.js";
import { transaction, ownerId } from "./db.js";
import { localPreview } from "./runtime.js";

export function origin() {
  const value = process.env.PUBLIC_ORIGIN || process.env.AUTH_URL;
  if (!value) throw new Error("Application origin is required.");
  const parsed = new URL(value);
  if (parsed.origin !== value || !["https:", "http:"].includes(parsed.protocol)) throw new Error("Use an exact application origin.");
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:" && !localPreview()) throw new Error("HTTPS is required.");
  return value;
}
export function secureCookies() { return origin().startsWith("https:"); }
export function checkOrigin(req) {
  if (req.headers.get("origin") !== origin()) throw new HttpError(403, "Request origin is not allowed.");
}
export function cookies(req) {
  return Object.fromEntries((req.headers.get("cookie") || "").split(";").map(part => {
    const index = part.indexOf("="); return index < 0 ? ["", ""] : [part.slice(0, index).trim(), part.slice(index + 1)];
  }));
}
export function authSecret() {
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) throw new Error("A session secret is required.");
  return process.env.AUTH_SECRET;
}
function sign(value) { return createHmac("sha256", authSecret()).update(value).digest("base64url"); }
export function validCsrf(token, subject) {
  if (typeof token !== "string" || token.length > 512) return false;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return false;
  const expected = sign(payload);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  try { const data = JSON.parse(Buffer.from(payload, "base64url")); return data.sub === sign(subject) && Number.isInteger(data.exp) && data.exp > Date.now() && data.exp < Date.now() + 49 * 3600000; }
  catch { return false; }
}
export function csrfToken(previous, subject) {
  if (validCsrf(previous, subject)) return previous;
  const payload = Buffer.from(JSON.stringify({ sub: sign(subject), exp: Date.now() + 48 * 3600000, nonce: randomBytes(24).toString("base64url") })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}
export function csrfSubject(req, actor) {
  if (actor) return `session:${actor.sid}`;
  const anonymous = cookies(req).arena_anon;
  return anonymous && /^[a-f0-9]{48}$/.test(anonymous) ? `anonymous:${anonymous}` : null;
}
export function requireCsrf(req, actor) {
  checkOrigin(req);
  const subject = csrfSubject(req, actor);
  if (!subject || !validCsrf(req.headers.get("x-csrf-token"), subject)) throw new HttpError(403, "Refresh your session and try again.");
}
export function cookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookies() ? "; Secure" : ""}`;
}
export function peer(req) {
  // The public proxy overwrites this header. Private peer containers are outside
  // this IP-rate boundary; authenticated owner and shared spend caps are separate.
  const value = (req.headers.get("x-forwarded-for") || "local").split(",").map(s => s.trim()).at(-1);
  return /^[a-fA-F0-9:.]{1,64}$/.test(value) ? value : "local";
}
export async function limit(key, maximum, seconds) {
  const digest = sign(`rate:${key}`);
  await transaction(async client => {
    const row = (await client.query(`INSERT INTO rates(key,window_start,count) VALUES($1,now(),1)
      ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rates.window_start<now()-$2::interval THEN 1 ELSE rates.count+1 END,
      window_start=CASE WHEN rates.window_start<now()-$2::interval THEN now() ELSE rates.window_start END RETURNING count`, [digest, `${seconds} seconds`])).rows[0];
    if (row.count > maximum) throw new HttpError(429, "Too many requests. Please wait and try again.");
    await client.query("DELETE FROM rates WHERE window_start<now()-interval '2 days'");
    if ((await client.query("SELECT count(*)::int AS count FROM rates")).rows[0].count > 20000) throw new HttpError(429, "Request capacity is busy. Please try later.");
  });
}
export async function userLimit(actor, action, maximum, seconds) { return limit(`owner:${ownerId(actor.id)}:${action}`, maximum, seconds); }
