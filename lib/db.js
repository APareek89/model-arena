import pg from "pg";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { HttpError } from "./http.js";
import { localPreview } from "./runtime.js";

let connectionPool;
let initializing;
export function databaseUrlWithoutSsl(address) {
  const parsed = new URL(address);
  // pg connection-string parsing can override the explicit TLS object even for
  // ssl=no-verify. Remove the entire case-insensitive ssl option namespace.
  for (const name of [...parsed.searchParams.keys()]) if (name.toLowerCase().startsWith('ssl')) parsed.searchParams.delete(name);
  return parsed.toString();
}
export async function database() {
  if (!initializing) initializing = initialize().catch(error => { initializing = undefined; throw error; });
  await initializing;
  return connectionPool;
}

async function initialize() {
  if (process.env.PORTFOLIO_AUTH_ENABLED === "0") throw new Error("Authentication cannot be disabled in this application.");
  const address = process.env.DATABASE_URL;
  if (!address) throw new Error("Database configuration is required.");
  const parsed = new URL(address);
  const preview = localPreview();
  let ssl;
  if (process.env.DATABASE_SSL === "disable") {
    if ((process.env.NODE_ENV === "production" && !preview) || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname)) throw new Error("Plaintext is restricted to local test databases.");
    ssl = false;
  } else {
    if (!process.env.DATABASE_SSL_CA_FILE) throw new Error("Verified database TLS is required.");
    ssl = { rejectUnauthorized: true, ca: await readFile(process.env.DATABASE_SSL_CA_FILE, "utf8") };
  }
  // URL SSL options must not replace the explicitly verified CA configuration.
  const candidate = new pg.Pool({ connectionString: databaseUrlWithoutSsl(address), ssl, max: 6, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000, statement_timeout: 15000 });
  const client = await candidate.connect().catch(async error => { await candidate.end(); throw error; });
  let failed = true;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(74435001)");
    if (process.env.DATABASE_NAME) {
      const identity = (await client.query("SELECT current_database() AS name")).rows[0];
      if (identity.name !== process.env.DATABASE_NAME) throw new Error("Unexpected database.");
    }
    await client.query(await readFile(join(process.cwd(), "migrations/001_portfolio.sql"), "utf8"));
    // An incompatible existing users table fails the transaction; never silently adopt it.
    await client.query("SELECT id,email,password_hash,disabled,created_at FROM users LIMIT 0");
    await client.query("COMMIT");
    connectionPool = candidate;
    failed = false;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); if (failed) await candidate.end(); }
}

export async function query(sql, params = []) { return (await database()).query(sql, params); }
export async function transaction(action) {
  const client = await (await database()).connect();
  try { await client.query("BEGIN"); const result = await action(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export function ownerId(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw new HttpError(401, "Sign in to continue.");
  return value;
}

export async function closeDatabase() {
  const old = connectionPool; connectionPool = undefined; initializing = undefined;
  if (old) await old.end();
}
