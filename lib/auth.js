import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { getToken } from "next-auth/jwt";
import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import { query, transaction, ownerId } from "./db.js";
import { HttpError, json, readJson, route } from "./http.js";
import { authSecret, cookie, cookies, csrfToken, limit, origin, peer, requireCsrf, secureCookies } from "./security.js";

const dummyHash = bcrypt.hashSync(randomBytes(32).toString("hex"), 10);
const SESSION_SECONDS = 7 * 86400;
function sessionCookie() { return secureCookies() ? "__Secure-arena-session" : "arena-session"; }

export function credentialsInput(value) {
  const email = typeof value?.email === "string" ? value.email.trim().toLowerCase() : "";
  const password = typeof value?.password === "string" ? value.password : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || Buffer.byteLength(password) > 72) throw new HttpError(400, "Use a valid email and a password of at least 12 characters, up to 72 UTF-8 bytes.");
  return { email, password };
}

export async function activeSession(id, sid) {
  if (!id || !sid) return null;
  try { ownerId(id); ownerId(sid); } catch { return null; }
  const result = await query(`SELECT u.id,u.email,s.id AS sid FROM users u JOIN sessions s ON s.owner_id=u.id
    WHERE u.id=$1 AND s.id=$2 AND NOT u.disabled AND s.revoked_at IS NULL AND s.expires_at>now()`, [id, sid]);
  return result.rows[0] || null;
}

async function authorize(value, request) {
  await limit(`login-ip:${peer(request)}`, 30, 900);
  let input;
  try { input = credentialsInput(value); } catch { return null; }
  await limit(`login-email:${input.email}`, 15, 900);
  const user = (await query("SELECT id,email,password_hash,disabled FROM users WHERE email=$1", [input.email])).rows[0];
  const valid = await bcrypt.compare(input.password, user?.password_hash || dummyHash);
  if (!user || !valid || user.disabled) return null;
  const sid = randomUUID();
  await transaction(async client => {
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user.id]);
    await client.query("DELETE FROM sessions WHERE owner_id=$1 AND (expires_at<now() OR revoked_at IS NOT NULL)", [user.id]);
    const current = (await client.query("SELECT count(*)::int AS count FROM sessions WHERE owner_id=$1", [user.id])).rows[0].count;
    if (current >= 20) throw new HttpError(429, "Sign out of another session before signing in again.");
    await client.query("INSERT INTO sessions(id,owner_id,expires_at) VALUES($1,$2,now()+interval '7 days')", [sid, user.id]);
  });
  return { id: user.id, email: user.email, sid };
}

// Lazy configuration keeps build-time imports independent of deployment secrets.
export const { handlers, auth } = NextAuth(() => ({
  secret: authSecret(),
  trustHost: true,
  useSecureCookies: secureCookies(),
  session: { strategy: "jwt", maxAge: SESSION_SECONDS },
  cookies: { sessionToken: { name: sessionCookie(), options: { httpOnly: true, sameSite: "lax", path: "/", secure: secureCookies() } } },
  providers: [Credentials({ credentials: { email: { type: "email" }, password: { type: "password" } }, authorize })],
  callbacks: {
    async jwt({ token, user }) { if (user) { token.id = user.id; token.sid = user.sid; } return token; },
    async session({ session, token }) {
      const actor = await activeSession(token.id, token.sid);
      return { ...session, user: actor ? { id: actor.id, email: actor.email } : undefined };
    },
    async redirect({ url }) {
      const base = origin();
      try { const target = new URL(url, base); return target.origin === base ? target.toString() : base; } catch { return base; }
    },
  },
  events: { async signOut(message) { const token = message.token; if (token?.id && token?.sid) await query("UPDATE sessions SET revoked_at=now() WHERE id=$1 AND owner_id=$2", [ownerId(token.sid), ownerId(token.id)]); } },
  logger: { error() {}, warn() {}, debug() {} },
}));

export async function actorFor(req) {
  const token = await getToken({ req, secret: authSecret(), cookieName: sessionCookie(), salt: sessionCookie(), secureCookie: secureCookies() });
  return token ? activeSession(token.id, token.sid) : null;
}
export async function requireActor(req, { write = false } = {}) {
  const actor = await actorFor(req);
  if (!actor) throw new HttpError(401, "Sign in to continue.");
  if (write) requireCsrf(req, actor);
  return actor;
}

export const sessionResponse = route(async req => {
  const actor = await actorFor(req);
  const previous = cookies(req);
  const anonymous = /^[a-f0-9]{48}$/.test(previous.arena_anon || "") ? previous.arena_anon : randomBytes(24).toString("hex");
  const subject = actor ? `session:${actor.sid}` : `anonymous:${anonymous}`;
  const csrf = csrfToken(previous.arena_csrf, subject);
  const response = json({ enabled: true, user: actor ? { id: actor.id, email: actor.email } : null, csrf_token: csrf });
  response.headers.append("Set-Cookie", cookie("arena_anon", anonymous, SESSION_SECONDS));
  response.headers.append("Set-Cookie", cookie("arena_csrf", csrf, 48 * 3600));
  return response;
});

export const signupResponse = route(async req => {
  const actor = await actorFor(req);
  requireCsrf(req, actor);
  await limit(`signup-ip:${peer(req)}`, 10, 3600);
  const { email, password } = credentialsInput(await readJson(req, 4096));
  const hash = await bcrypt.hash(password, 12);
  try {
    await transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(74435002)");
      if ((await client.query("SELECT count(*)::int AS count FROM users")).rows[0].count >= 1000) throw new HttpError(429, "Account capacity is reached. Please try later.");
      await client.query("INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)", [randomUUID(), email, hash]);
    });
  } catch (error) { if (error.code === "23505") throw new HttpError(409, "An account already exists for this email."); throw error; }
  return json({ ok: true }, 201);
});
