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
    const prompt = String(value.prompt ?? value.question ?? value.input ?? value.text ?? value.user ?? '');
    const reference = String(value.reference ?? value.reference_answer ?? value.answer ?? value.expected ?? '');
    if ((!allowBlank && !prompt.trim()) || prompt.length > LIMITS.prompt || reference.length > LIMITS.reference) throw new Error('Each prompt needs text; prompts and reference answers are limited to 8,000 characters each.');
    const id = String(value.id || newId());
    if (id.length > 80 || seen.has(id)) throw new Error('Prompt IDs must be unique and at most 80 characters.');
    seen.add(id); return { id, prompt, reference };
  });
}
export function csvEscape(value) {
  let s = String(value ?? '');
  // Spreadsheet formula prefixes remain plain text when opened in Excel or Sheets.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function readWorkspace(storage, key) {
  const raw = storage.getItem(key);
  if (!raw) return null;
  if (raw.length > LIMITS.savedBytes) throw new Error('Saved workspace is too large.');
  const value = JSON.parse(raw);
  if (!value || !Array.isArray(value.models) || value.models.length > 3 || !value.models.every(m => typeof m === 'string' && m.length <= 160)) throw new Error('Invalid saved models.');
  if (typeof value.system !== 'string' || value.system.length > LIMITS.system || typeof value.corpus !== 'string' || value.corpus.length > LIMITS.corpus) throw new Error('Invalid saved text.');
  const prompts = value.prompts?.length ? parsePromptFile(JSON.stringify(value.prompts), { allowBlank: true }) : [];
  const settled = entries => Object.fromEntries(Object.entries(entries || {}).slice(0, 300).map(([id, item]) => [id, ['queued', 'running'].includes(item?.status) ? { status: 'error', error: 'Interrupted by reload. Run this item again.' } : item]));
  return { ...value, prompts, models: [...value.models, '', '', ''].slice(0, 3), placement: value.placement === 'system' ? 'system' : 'user', maxTokens: Math.min(1024, Math.max(32, Number(value.maxTokens) || 300)), temperature: Math.min(1.5, Math.max(0, Number(value.temperature) || 0)), results: settled(value.results), grades: settled(value.grades) };
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
