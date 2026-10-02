export const LIMITS = { prompts: 30, prompt: 8000, reference: 8000, system: 20000, corpus: 30000, fileBytes: 2 * 1024 * 1024, savedBytes: 4 * 1024 * 1024 };
export const newId = () => globalThis.crypto?.randomUUID?.() || `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
export function parsePromptFile(text, { allowBlank = false } = {}) {
  if (new TextEncoder().encode(text).length > LIMITS.fileBytes) throw new Error('Choose a prompt file smaller than 2 MiB.');
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : Array.isArray(data?.prompts) ? data.prompts : null;
  if (!list) throw new Error('Expected a JSON array, or an object with a prompts array.');
  if (!list.length || list.length > LIMITS.prompts) throw new Error('Use between 1 and 30 prompts.');
  const seen = new Set();
  return list.map(item => {
    const value = typeof item === 'string' ? { prompt: item } : item;
    if (!value || typeof value !== 'object') throw new Error('Every item must be a prompt string or an object.');
    const prompt = value.prompt ?? value.question ?? value.input ?? value.text ?? value.user ?? '';
    const reference = value.reference ?? value.reference_answer ?? value.answer ?? value.expected ?? '';
    if (typeof prompt !== 'string' || typeof reference !== 'string') throw new Error('Prompt and reference values must be text.');
    if ((!allowBlank && !prompt.trim()) || prompt.length > LIMITS.prompt || reference.length > LIMITS.reference) throw new Error('Each prompt needs text; prompts and reference answers are limited to 8,000 characters each.');
    const id = value.id ?? newId();
    if (typeof id !== 'string' || !id || id.length > 80 || /[|\u0000-\u001f]/.test(id) || seen.has(id)) throw new Error('Prompt IDs must be unique text of at most 80 characters, without control characters or |.');
    seen.add(id); return { id, prompt, reference };
  });
}
export function csvEscape(value) {
  let s = String(value ?? '');
  // Spreadsheet formula prefixes remain plain text when opened in Excel or Sheets.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const safeText = (value, limit) => typeof value === 'string' && value.length <= limit;
const numericUsage = usage => {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  return Object.fromEntries(['prompt_tokens', 'completion_tokens', 'total_tokens', 'input_tokens', 'output_tokens', 'reasoning_tokens', 'promptTokenCount', 'candidatesTokenCount', 'totalTokenCount'].filter(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0).map(key => [key, usage[key]]));
};

export function restoreEntries(entries, grading = false) {
  if (entries == null) return {};
  if (typeof entries !== 'object' || Array.isArray(entries)) throw new Error('Invalid saved results.');
  const invalid = () => ({ status: 'error', error: 'This saved result could not be restored safely. Run or grade it again.' });
  return Object.fromEntries(Object.entries(entries).slice(0, 300).map(([id, item]) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [id, invalid()];
    if (['queued', 'running'].includes(item.status)) return [id, { status: 'error', error: 'Interrupted by reload. Run this item again.' }];
    if (item.status === 'stopped') return [id, { status: 'stopped' }];
    if (item.status === 'error') return [id, { status: 'error', error: safeText(item.error, 4000) ? item.error : invalid().error, ...(typeof item.requestId === 'string' && /^[0-9a-f-]{36}$/.test(item.requestId) ? { requestId: item.requestId } : {}) }];
    if (item.status !== 'done') return [id, invalid()];
    const common = { status: 'done', cached: item.cached === true, ms: Number.isFinite(item.ms) && item.ms >= 0 ? item.ms : null, usage: numericUsage(item.usage), ...(safeText(item.provider, 50) ? { provider: item.provider } : {}) };
    if (!grading) {
      if (!safeText(item.text, 64000)) return [id, invalid()];
      return [id, { ...common, text: item.text, finish: safeText(item.finish, 40) ? item.finish : null, ...(safeText(item.servedModel, 240) ? { servedModel: item.servedModel } : {}), ...(safeText(item.routeProvider, 80) ? { routeProvider: item.routeProvider } : {}), attempts: Number.isInteger(item.attempts) && item.attempts >= 0 && item.attempts <= 10 ? item.attempts : 1 }];
    }
    const pairs = item.scores && typeof item.scores === 'object' && !Array.isArray(item.scores) ? Object.entries(item.scores) : [];
    if (pairs.length < 1 || pairs.length > 3 || !safeText(item.grader, 100) || !pairs.some(([model]) => model === item.best)) return [id, invalid()];
    const scores = Object.create(null);
    for (const [model, score] of pairs) {
      if (!safeText(model, 240) || !score || typeof score !== 'object' || ![score.accuracy, score.helpfulness, score.format].every(value => Number.isInteger(value) && value >= 1 && value <= 10) || !safeText(score.reason, 2000)) return [id, invalid()];
      scores[model] = { accuracy: score.accuracy, helpfulness: score.helpfulness, format: score.format, reason: score.reason, overall: Math.round((score.accuracy + score.helpfulness + score.format) / 3 * 10) / 10 };
    }
    return [id, { ...common, grader: item.grader, best: item.best, scores, ranking: Object.keys(scores).sort((a, b) => scores[b].overall - scores[a].overall), ...(item.billing?.source === 'user_key' ? { billing: { source: 'user_key', costUSD: null } } : {}) }];
  }));
}

export function readWorkspace(storage, key) {
  const raw = storage.getItem(key);
  if (!raw) return null;
  if (raw.length > LIMITS.savedBytes) throw new Error('Saved workspace is too large.');
  const value = JSON.parse(raw);
  if (!value || !Array.isArray(value.models) || value.models.length > 3 || !value.models.every(m => typeof m === 'string' && m.length <= 160)) throw new Error('Invalid saved models.');
  if (typeof value.system !== 'string' || value.system.length > LIMITS.system || typeof value.corpus !== 'string' || value.corpus.length > LIMITS.corpus) throw new Error('Invalid saved text.');
  if (!Array.isArray(value.prompts)) throw new Error('Invalid saved prompts.');
  const prompts = value.prompts.length ? parsePromptFile(JSON.stringify(value.prompts), { allowBlank: true }) : [];
  return { models: [...value.models, '', '', ''].slice(0, 3), system: value.system, corpus: value.corpus, grader: safeText(value.grader, 100) ? value.grader : undefined, graderProvider: safeText(value.graderProvider, 20) ? value.graderProvider : undefined, exampleId: safeText(value.exampleId, 100) ? value.exampleId : undefined, prompts, placement: value.placement === 'system' ? 'system' : 'user', maxTokens: Math.min(1024, Math.max(32, Number(value.maxTokens) || 300)), temperature: Math.min(1.5, Math.max(0, Number(value.temperature) || 0)), results: restoreEntries(value.results), grades: restoreEntries(value.grades, true) };
}

export async function runQueue(jobs, concurrency, execute, canStart = () => true) {
  let index = 0;
  const worker = async () => { while (index < jobs.length && canStart()) { const job = jobs[index++]; await execute(job); } };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
}

export function invalidateComparison(results, grades, { promptId, gradesOnly = false } = {}) {
  const nextGrades = promptId ? Object.fromEntries(Object.entries(grades).filter(([id]) => id !== promptId)) : {};
  const nextResults = gradesOnly ? results : promptId ? Object.fromEntries(Object.entries(results).filter(([key]) => !key.startsWith(`${promptId}|`))) : {};
  return { results: nextResults, grades: nextGrades };
}

// FileReader callbacks can arrive out of order. A later selection or any manual
// workspace edit invalidates older callbacks before they can replace user work.
export function createImportGate() {
  const versions = new Map();
  const invalidate = kind => versions.set(kind, (versions.get(kind) || 0) + 1);
  return {
    begin(kind) { invalidate(kind); const version = versions.get(kind); return () => versions.get(kind) === version; },
    invalidate,
    invalidateAll() { for (const kind of versions.keys()) invalidate(kind); },
  };
}
