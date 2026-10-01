import { randomUUID } from "node:crypto";
import { query, transaction, ownerId } from "./db.js";
import { HttpError } from "./http.js";

const STATE = Symbol.for("model-arena.provider-capacity");
const capacity = globalThis[STATE] ||= { total: 0, owners: new Map() };

export async function withCapacity(actor, action) {
  const owner = ownerId(actor.id);
  if (capacity.total >= 6 || (capacity.owners.get(owner) || 0) >= 3) throw new HttpError(429, "Comparison capacity is busy. Wait for a current request to finish.");
  capacity.total++; capacity.owners.set(owner, (capacity.owners.get(owner) || 0) + 1);
  try { return await action(); }
  finally { capacity.total--; const count = capacity.owners.get(owner) - 1; if (count) capacity.owners.set(owner, count); else capacity.owners.delete(owner); }
}

function cap(name, fallback) {
  const raw = process.env[name] || fallback;
  if (!/^(?:\d+(?:\.\d{1,8})?|\.\d{1,8})$/.test(raw) || !Number.isFinite(Number(raw)) || Number(raw) > 10) throw new Error("Invalid application budget.");
  return raw;
}
export async function reserve(actor, kind, model, request, maxOutput) {
  const owner = ownerId(actor.id);
  const inputBound = Buffer.byteLength(JSON.stringify(request)) + 4096;
  if (inputBound > 768 * 1024 || !Number.isInteger(maxOutput) || maxOutput < 1 || maxOutput > 2048) throw new HttpError(400, "Provider input exceeds the comparison limit.");
  if (![model.inputPrice, model.outputPrice].every(value => Number.isFinite(value) && value >= 0 && value < 100)) throw new HttpError(400, "This model has no verified price.");
  const id = randomUUID();
  return transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(74435003)");
    const user = (await client.query("SELECT id FROM users WHERE id=$1 AND NOT disabled", [owner])).rows[0];
    if (!user) throw new HttpError(401, "Sign in to continue.");
    const cost = (await client.query("SELECT (($1::numeric*$2::numeric)+($3::numeric*$4::numeric))/1000000 AS value", [inputBound, model.inputPrice, maxOutput, model.outputPrice])).rows[0].value;
    const totals = (await client.query(`SELECT count(*)::int AS count,
      coalesce(sum(coalesce(actual_usd,reserved_usd)),0) AS total,
      coalesce(sum(coalesce(actual_usd,reserved_usd)) FILTER(WHERE owner_id=$1),0) AS own FROM usage`, [owner])).rows[0];
    const bounds = (await client.query("SELECT $1::numeric+$2::numeric<=$3::numeric AS own_ok,$4::numeric+$2::numeric<=$5::numeric AS total_ok", [totals.own, cost, cap("MODEL_ARENA_OWNER_BUDGET_USD", "0.02"), totals.total, cap("MODEL_ARENA_SHARED_BUDGET_USD", "0.10")])).rows[0];
    if (totals.count >= 100000) throw new HttpError(429, "The request ledger is full. Prepared examples remain available.");
    if (!bounds.own_ok || !bounds.total_ok) throw new HttpError(429, "The included comparison budget is used. Prepared examples remain available.");
    await client.query(`INSERT INTO usage(id,owner_id,kind,provider,model,upstream_model,input_price,output_price,cached_price,reserved_usd,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'reserved')`, [id, owner, kind, model.provider, model.id, model.upstream, model.inputPrice, model.outputPrice, model.cachedPrice ?? null, cost]);
    return id;
  });
}

export async function settle(actor, id, values) {
  const owner = ownerId(actor.id);
  const incoming = values?.input, outgoing = values?.output;
  if (!Number.isInteger(incoming) || !Number.isInteger(outgoing) || incoming < 0 || outgoing < 0) {
    await query("UPDATE usage SET status='usage_unavailable' WHERE id=$1 AND owner_id=$2 AND status='reserved'", [id, owner]); return;
  }
  const cached = Number.isInteger(values.cached) ? Math.min(incoming, Math.max(0, values.cached)) : 0;
  const reasoning = Number.isInteger(values.reasoning) ? Math.min(outgoing, Math.max(0, values.reasoning)) : 0;
  await query(`UPDATE usage SET actual_usd=(($3::numeric-$5::numeric)*input_price+$5::numeric*coalesce(cached_price,input_price)+$4::numeric*output_price)/1000000,
    input_tokens=$3,output_tokens=$4,cached_input_tokens=$5,reasoning_output_tokens=$6,status='complete' WHERE id=$1 AND owner_id=$2 AND status='reserved'`, [id, owner, incoming, outgoing, cached, reasoning]);
}
export async function uncertain(actor, id) { await query("UPDATE usage SET status='uncertain' WHERE id=$1 AND owner_id=$2 AND status='reserved'", [id, ownerId(actor.id)]); }
export async function ownUsage(actor) {
  return (await query("SELECT count(*)::int AS requests,coalesce(sum(coalesce(actual_usd,reserved_usd)),0)::text AS accounted_usd FROM usage WHERE owner_id=$1", [ownerId(actor.id)])).rows[0];
}
