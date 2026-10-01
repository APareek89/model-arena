import { HttpError } from "./http.js";
import { providerJson } from "./provider-http.js";

const CATALOG = Symbol.for("model-arena.catalog");
const state = globalThis[CATALOG] ||= { hf: null, gemini: null, hfPending: null, geminiPending: null };
const MAX_AGE = 5 * 60000;
const GEMINI_PRICES = { "gemini-2.5-flash-lite": { inputPrice: .10, outputPrice: .40 } };
const MOCK_HF = [
  { id: "Qwen/Qwen3-4B-Instruct-2507", providers: [{ provider: "nscale", status: "live", pricing: { input: .01, output: .03 } }] },
  { id: "meta-llama/Llama-3.1-8B-Instruct", providers: [{ provider: "deepinfra", status: "live", pricing: { input: .02, output: .05 } }] },
];
export const mockMode = () => process.env.MODEL_ARENA_MOCK_MODE === "1";
function small(id) { const m = id.match(/(\d+(?:\.\d+)?)B/i); return !/A\d+(?:\.\d+)?B/i.test(id) && Boolean(m) && Number(m[1]) <= 9; }
function validPrice(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 100; }

export function pricedHF(entry, provider) {
  if (!entry || typeof entry.id !== "string" || !Array.isArray(entry.providers)) return null;
  const possible = entry.providers.filter(p => p.status === "live" && typeof p.provider === "string" && /^[a-z0-9-]{1,40}$/.test(p.provider) && validPrice(p.pricing?.input) && validPrice(p.pricing?.output) && (!provider || p.provider === provider));
  possible.sort((a, b) => a.pricing.output - b.pricing.output || a.pricing.input - b.pricing.input || a.provider.localeCompare(b.provider));
  const selected = possible[0];
  return selected ? { id: entry.id, provider: "huggingface", upstream: `${entry.id}:${selected.provider}`, routeProvider: selected.provider, inputPrice: selected.pricing.input, outputPrice: selected.pricing.output, contextLength: selected.context_length ?? null } : null;
}
async function refresh(kind) {
  if (mockMode()) return kind === "hf" ? { at: Date.now(), entries: MOCK_HF, mock: true } : { at: Date.now(), entries: Object.keys(GEMINI_PRICES), mock: true };
  const key = kind === "hf" ? process.env.HF_TOKEN : process.env.GEMINI_API_KEY;
  if (!key) throw new HttpError(503, "This hosted provider is unavailable. Try the prepared example.");
  if (kind === "hf") {
    const response = await providerJson("https://router.huggingface.co/v1/models", { headers: { Authorization: `Bearer ${key}` } }, { timeout: 15000, maximum: 2 * 1024 * 1024 });
    if (!Array.isArray(response.data) || response.data.length > 3000) throw new HttpError(502, "Provider catalog is unavailable.");
    return { at: Date.now(), entries: response.data, mock: false };
  }
  const response = await providerJson("https://generativelanguage.googleapis.com/v1beta/models?pageSize=100", { headers: { "x-goog-api-key": key } }, { timeout: 15000, maximum: 1024 * 1024 });
  if (!Array.isArray(response.models) || response.models.length > 100) throw new HttpError(502, "Grader catalog is unavailable.");
  const available = response.models.filter(m => m.supportedGenerationMethods?.includes("generateContent")).map(m => String(m.name).replace(/^models\//, ""));
  return { at: Date.now(), entries: available.filter(id => GEMINI_PRICES[id]), mock: false };
}
async function catalog(kind) {
  const current = state[kind];
  if (current && current.mock === mockMode() && Date.now() - current.at < MAX_AGE) return current;
  const pending = `${kind}Pending`;
  if (!state[pending]) state[pending] = refresh(kind).then(value => { state[kind] = value; return value; }).finally(() => { state[pending] = null; });
  return state[pending];
}
export async function modelCatalog() {
  const current = await catalog("hf");
  return { models: current.entries.filter(e => typeof e.id === "string" && e.id.length <= 240).map(entry => { const priced = pricedHF(entry); return { id: entry.id, small: small(entry.id), funded: Boolean(priced), ...(priced ? { routeProvider: priced.routeProvider, inputPrice: priced.inputPrice, outputPrice: priced.outputPrice } : {}) }; }).sort((a, b) => a.id.localeCompare(b.id)), fetchedAt: new Date(current.at).toISOString(), pricingUnit: "USD per million tokens", mode: current.mock ? "mock" : "live" };
}
export async function graderCatalog() { const current = await catalog("gemini"); return { models: current.entries, default: "gemini-2.5-flash-lite", fetchedAt: new Date(current.at).toISOString(), mode: current.mock ? "mock" : "live" }; }
export async function resolveHF(id) {
  const [base, provider, extra] = id.split(":");
  if (extra || (provider && !/^[a-z0-9-]{1,40}$/.test(provider))) throw new HttpError(400, "Invalid model provider route.");
  const current = await catalog("hf");
  const resolved = pricedHF(current.entries.find(entry => entry.id === base), provider);
  if (!resolved) throw new HttpError(400, "This model route has no current verified price. Choose a priced model route from the list.");
  return resolved;
}
export async function resolveGrader(id) {
  const current = await catalog("gemini");
  if (!current.entries.includes(id) || !GEMINI_PRICES[id]) throw new HttpError(400, "Choose an available grader with a verified price.");
  return { id, upstream: id, provider: "gemini", ...GEMINI_PRICES[id] };
}
export function clearCatalogForTests() { state.hf = state.gemini = null; }
