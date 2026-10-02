"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FlaskConical, Play, Plus, RefreshCw, Square, Trash2, X } from 'lucide-react';
import AccountGate from './components/AccountGate';
import { session, ownerStorageKey } from './client/session.mjs';
import { GRADER_PROVIDERS, graderSelection, graderProblem, finishWarning } from './client/grader.mjs';
import { LIMITS, newId as uid, parsePromptFile, csvEscape, readWorkspace, runQueue, invalidateComparison, createImportGate } from './client/workspace.mjs';

const DEFAULT_SYSTEM = "You are a helpful assistant. Answer clearly with specific reasons. If a reference is supplied, use only the reference and say when it does not contain the answer.";
const DEFAULT_MODELS = ["Qwen/Qwen3-4B-Instruct-2507", "meta-llama/Llama-3.1-8B-Instruct", ""];
const SAMPLE_PROMPTS = [
  { prompt: "Which is the best Avengers movie and why?", reference: "" },
  { prompt: "Recommend a romantic movie. Give three distinct reasons and one caveat, under 120 words.", reference: "" },
  { prompt: "Who directed Inception (2010)? Answer with the name only.", reference: "Christopher Nolan" },
];
const CONCURRENCY = 3;
const GRADE_CONCURRENCY = 2;

const ck = (pid, model) => `${pid}|${model}`;
const fmtMs = (ms) => (ms == null ? "Timing unavailable" : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);

function download(name, text, type, epoch) {
  session.assert(epoch);
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Page() {
  return <AccountGate>{account => <ArenaWorkspace key={account.user?.id || 'local-fixture'} ownerId={account.user?.id || 'local-fixture'} />}</AccountGate>;
}

function ArenaWorkspace({ ownerId }) {
  const [loaded, setLoaded] = useState(false);
  const [config, setConfig] = useState({ hf: false, gemini: false, loaded: false });
  const [exampleId, setExampleId] = useState(null);
  const [loadingExample, setLoadingExample] = useState(false);
  const [available, setAvailable] = useState([]);
  const [tab, setTab] = useState("compare");
  const [graderProvider, setGraderProvider] = useState("gemini");
  const [graderKey, setGraderKey] = useState(""); // Session memory only: never persist or export.
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState(DEFAULT_MODELS);
  const [system, setSystem] = useState(DEFAULT_SYSTEM);
  const [corpus, setCorpus] = useState("");
  const [placement, setPlacement] = useState("user");
  const [maxTokens, setMaxTokens] = useState(300);
  const [temperature, setTemperature] = useState(0);
  const [grader, setGrader] = useState("gemini-2.5-flash-lite");
  const [prompts, setPrompts] = useState(() => SAMPLE_PROMPTS.map((p, i) => ({ id: `sample-${i + 1}`, ...p })));
  const [results, setResults] = useState({});
  const [grades, setGrades] = useState({});
  const [running, setRunning] = useState(false);
  const [grading, setGrading] = useState(false);
  const [notice, setNotice] = useState(null);
  const stopRef = useRef(false);

  const activeModels = useMemo(() => models.map((m) => m.trim()).filter(Boolean).filter((m, i, a) => a.indexOf(m) === i), [models]);
  const smallModels = useMemo(() => available.filter((m) => m.small && m.funded === true).map((m) => m.id), [available]);

  const ownerEpoch = useRef(session.capture());
  const exampleRef = useRef(null);
  const lifetime = useRef(null);
  const readers = useRef(new Set());
  const imports = useRef(null);
  if (!imports.current) imports.current = createImportGate();
  const busyRef = useRef(false);
  const storageWritable = useRef(true);
  const STORAGE_KEY = ownerStorageKey(ownerId);

  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    const epoch = ownerEpoch.current;
    try {
      const saved = readWorkspace(localStorage, STORAGE_KEY);
      if (saved) {
        setModels(saved.models); setSystem(saved.system); setCorpus(saved.corpus);
        setPlacement(saved.placement); setMaxTokens(saved.maxTokens); setTemperature(saved.temperature);
        const provider = saved.graderProvider || 'gemini';
        if (graderSelection(provider, saved.grader)) { setGraderProvider(provider); setGrader(saved.grader); }
        setPrompts(saved.prompts); setResults(saved.results); setGrades(saved.grades);
        if (typeof saved.exampleId === 'string') { setExampleId(saved.exampleId); exampleRef.current = saved.exampleId; }
      }
    } catch { storageWritable.current = false; setNotice({ kind: 'error', text: 'Saved data could not be opened. The previous browser copy has not been removed.' }); }
    setLoaded(true);
    return () => { controller.abort(); stopRef.current = true; readers.current.forEach(reader => reader.abort()); readers.current.clear(); };
  }, [STORAGE_KEY]);

  useEffect(() => {
    if (!loaded || !storageWritable.current || !session.current(ownerEpoch.current) || lifetime.current?.signal.aborted) return;
    try {
      const saved = JSON.stringify({ models, system, corpus, placement, maxTokens, temperature, grader, graderProvider, prompts, results, grades, exampleId });
      if (saved.length > LIMITS.savedBytes) throw new Error('storage');
      localStorage.setItem(STORAGE_KEY, saved);
    } catch { setNotice({ kind: 'error', text: 'Browser storage is full. Export your results to keep this comparison.' }); }
  }, [loaded, STORAGE_KEY, models, system, corpus, placement, maxTokens, temperature, grader, graderProvider, prompts, results, grades, exampleId]);

  const api = useCallback((path, opts = {}, epoch = ownerEpoch.current) => session.request(path, { ...opts, signal: lifetime.current?.signal, headers: { 'Content-Type': 'application/json', ...opts.headers } }, epoch), []);
  const active = epoch => session.current(epoch) && !lifetime.current?.signal.aborted;

  useEffect(() => {
    if (!loaded) return;
    const epoch = ownerEpoch.current;
    api('/api/config', {}, epoch).then(c => { if (active(epoch)) setConfig({ ...c, loaded: true }); }).catch(e => { if (active(epoch) && e.name !== 'AbortError') { setConfig(prev => ({ ...prev, loaded: true })); setNotice({ kind: 'error', text: e.message }); } });
  }, [loaded, api]);

  const refreshModels = useCallback(async () => {
    const epoch = ownerEpoch.current;
    try {
      const m = await api('/api/models', {}, epoch);
      if (active(epoch)) setAvailable(m.models || []);
    } catch (e) { if (active(epoch) && e.name !== 'AbortError') setNotice({ kind: 'error', text: `HF model list: ${e.message}` }); }
  }, [api]);
  useEffect(() => { if (loaded && config.loaded) refreshModels(); }, [loaded, config.loaded, refreshModels]);

  function edit(options = {}) {
    if (!options.importResult) imports.current.invalidateAll();
    storageWritable.current = true;
    setResults(prev => invalidateComparison(prev, {}, options).results);
    setGrades(prev => invalidateComparison({}, prev, options).grades);
    if (exampleId) { exampleRef.current = null; setExampleId(null); setNotice({ kind: 'info', text: 'You are editing a live comparison. Run and Grade now use the configured providers.' }); }
  }
  async function loadExample() {
    if (busyRef.current) return;
    imports.current.invalidateAll();
    const epoch = ownerEpoch.current; setLoadingExample(true); busyRef.current = true;
    try {
      const example = await api('/api/example', {}, epoch); if (!active(epoch)) return;
      storageWritable.current = true;
      const x = example.settings;
      setModels([...x.models, '', '', ''].slice(0, 3)); setSystem(x.system); setCorpus(x.corpus);
      setPlacement(x.placement); setMaxTokens(x.maxTokens); setTemperature(x.temperature);
      setPrompts(example.prompts); setResults({}); setGrades({}); exampleRef.current = example.id; setExampleId(example.id);
      setNotice({ kind: 'info', text: 'Prepared example loaded. Select Run all, then Grade all. Both are free.' });
    } catch (e) { if (active(epoch) && e.name !== 'AbortError') setNotice({ kind: 'error', text: e.message }); }
    finally { if (active(epoch)) { setLoadingExample(false); busyRef.current = false; } }
  }

  useEffect(() => { if (!notice || notice.kind === 'error') return; const t = setTimeout(() => setNotice(null), 6000); return () => clearTimeout(t); }, [notice]);

  function buildMessages(promptText) {
    const hasCorpus = corpus.trim().length > 0;
    const sys = placement === "system" && hasCorpus ? `${system}\n\nReference:\n${corpus}` : system;
    const user = placement === "user" && hasCorpus
      ? `Use only this supplied reference to answer. If the reference does not contain the answer, say so.\n\nReference:\n${corpus}\n\nQuestion: ${promptText}`
      : promptText;
    const msgs = [];
    if (sys.trim()) msgs.push({ role: "system", content: sys });
    msgs.push({ role: "user", content: user });
    return msgs;
  }

  async function runOne(p, m, epoch) {
    if (!active(epoch)) return;
    setResults((prev) => ({ ...prev, [ck(p.id, m)]: { status: "running" } }));
    try {
      const j = await api("/api/generate", { method: "POST", body: JSON.stringify({ model: m, messages: buildMessages(p.prompt), max_tokens: maxTokens, temperature, ...(exampleId ? { example_id: exampleId, prompt_id: p.id } : {}) }) }, epoch);
      if (!active(epoch)) return;
      setResults((prev) => ({ ...prev, [ck(p.id, m)]: { status: "done", ...j } }));
    } catch (e) {
      if (!active(epoch) || e.name === 'AbortError') return;
      setResults((prev) => ({ ...prev, [ck(p.id, m)]: { status: "error", error: e.message } }));
    }
  }

  async function runAll(onlyId = null) {
    if (busyRef.current) return;
    imports.current.invalidateAll();
    const epoch = ownerEpoch.current;
    if (!activeModels.length) return setNotice({ kind: "error", text: "Pick at least one model." });
    const targets = prompts.filter((p) => p.prompt.trim() && (!onlyId || p.id === onlyId));
    if (!targets.length) return setNotice({ kind: "error", text: "Add at least one prompt." });
    const jobs = []; for (const p of targets) for (const m of activeModels) jobs.push({ p, m });
    setRunning(true); busyRef.current = true; stopRef.current = false;
    setResults((prev) => { const n = { ...prev }; for (const { p, m } of jobs) n[ck(p.id, m)] = { status: "queued" }; return n; });
    setGrades((prev) => { const n = { ...prev }; for (const p of targets) delete n[p.id]; return n; });
    await runQueue(jobs, CONCURRENCY, job => runOne(job.p, job.m, epoch), () => !stopRef.current && active(epoch));
    if (active(epoch)) {
      setResults(prev => Object.fromEntries(Object.entries(prev).map(([id, r]) => [id, r.status === 'queued' ? { status: 'stopped' } : r])));
      setRunning(false); busyRef.current = false;
    }
  }

  function rowDone(p) { return activeModels.length > 0 && activeModels.every((m) => results[ck(p.id, m)]?.status === "done"); }

  async function gradeRow(p, epoch = ownerEpoch.current) {
    if (!active(epoch)) return;
    const responses = activeModels.map((m) => ({ model: m, text: results[ck(p.id, m)]?.text })).filter((r) => typeof r.text === "string");
    if (!responses.length) return;
    setGrades((prev) => ({ ...prev, [p.id]: { status: "running" } }));
    try {
      const j = await api("/api/grade", { method: "POST", body: JSON.stringify({ grader, graderProvider, graderKey, prompt: p.prompt, reference: p.reference || "", corpus, systemPrompt: system, responses, ...(exampleId ? { example_id: exampleId, prompt_id: p.id } : {}) }) }, epoch);
      if (!active(epoch)) return;
      setGrades((prev) => ({ ...prev, [p.id]: { status: "done", ...j } }));
    } catch (e) {
      if (!active(epoch) || e.name === 'AbortError') return;
      setGrades((prev) => ({ ...prev, [p.id]: { status: "error", error: e.message, requestId: e.requestId } }));
    }
  }

  async function gradeSingle(p) {
    imports.current.invalidateAll();
    if (!exampleId && graderProblem(graderProvider, grader, graderKey)) { setTab('configure'); return setNotice({ kind: 'error', text: graderProblem(graderProvider, grader, graderKey) }); }
    if (busyRef.current) return; const epoch = ownerEpoch.current;
    busyRef.current = true; setGrading(true);
    try { await gradeRow(p, epoch); } finally { if (active(epoch)) { busyRef.current = false; setGrading(false); } }
  }
  async function gradeAll() {
    imports.current.invalidateAll();
    if (!exampleId && graderProblem(graderProvider, grader, graderKey)) { setTab('configure'); return setNotice({ kind: 'error', text: graderProblem(graderProvider, grader, graderKey) }); }
    if (busyRef.current) return; const epoch = ownerEpoch.current;
    const targets = prompts.filter(rowDone);
    if (!targets.length) return setNotice({ kind: "error", text: "Run the prompts first; grading needs every model's answer for a row." });
    setGrading(true); busyRef.current = true;
    await runQueue(targets, GRADE_CONCURRENCY, p => gradeRow(p, epoch), () => active(epoch));
    if (active(epoch)) { setGrading(false); busyRef.current = false; }
  }

  const summary = useMemo(() => {
    return activeModels.map((m) => {
      let n = 0, acc = 0, help = 0, fmt = 0, overall = 0, wins = 0, errors = 0, ms = 0, done = 0;
      for (const p of prompts) {
        const r = results[ck(p.id, m)];
        if (r?.status === "error") errors++;
        if (r?.status === "done") { done++; ms += r.ms || 0; }
        const g = grades[p.id];
        const s = g?.status === "done" ? g.scores?.[m] : null;
        if (s) { n++; acc += s.accuracy; help += s.helpfulness; fmt += s.format; overall += s.overall; if (g.best === m) wins++; }
      }
      const avg = (x) => (n ? (x / n).toFixed(1) : "–");
      return { model: m, graded: n, accuracy: avg(acc), helpfulness: avg(help), format: avg(fmt), overall: avg(overall), wins, errors, avgMs: done ? Math.round(ms / done) : null };
    });
  }, [activeModels, prompts, results, grades]);

  function exportJson() {
    const epoch = ownerEpoch.current; if (!active(epoch)) return;
    download(`model-arena-${new Date().toISOString().slice(0, 19)}.json`, JSON.stringify({
      exportedAt: new Date().toISOString(), settings: { models: activeModels, system, corpusChars: corpus.length, placement, maxTokens, temperature, grader, graderProvider },
      prompts, results, grades, summary,
    }, null, 2), "application/json", epoch);
  }
  function exportCsv() {
    const epoch = ownerEpoch.current; if (!active(epoch)) return;
    const rows = [["prompt_id", "prompt", "reference", "model", "status", "response", "latency_ms", "completion_tokens", "accuracy", "helpfulness", "format", "overall", "best", "grader_reason"]];
    for (const p of prompts) for (const m of activeModels) {
      const r = results[ck(p.id, m)] || {}; const g = grades[p.id]; const s = g?.status === "done" ? g.scores?.[m] : null;
      rows.push([p.id, p.prompt, p.reference || "", m, r.status || "", r.text || r.error || "", r.ms ?? "", r.usage?.completion_tokens ?? "", s?.accuracy ?? "", s?.helpfulness ?? "", s?.format ?? "", s?.overall ?? "", g?.best === m ? "yes" : "", s?.reason ?? ""]);
    }
    download(`model-arena-${new Date().toISOString().slice(0, 19)}.csv`, rows.map((r) => r.map(csvEscape).join(",")).join("\n"), "text/csv", epoch);
  }

  function readFile(file, kind, apply) {
    const epoch = ownerEpoch.current; if (!active(epoch)) return;
    const isLatest = imports.current.begin(kind);
    if (file.size > LIMITS.fileBytes) return setNotice({ kind: 'error', text: 'Choose a file smaller than 2 MiB.' });
    const reader = new FileReader(); readers.current.add(reader);
    reader.onload = () => { if (!active(epoch) || !isLatest()) return; try { apply(String(reader.result)); } catch (e) { setNotice({ kind: 'error', text: e.message }); } };
    reader.onerror = () => { if (active(epoch) && isLatest()) setNotice({ kind: 'error', text: 'This file could not be read. Try a text or JSON file.' }); };
    reader.onloadend = () => readers.current.delete(reader); reader.readAsText(file);
  }
  function onPromptFile(file) { readFile(file, 'prompts', text => { const list = parsePromptFile(text); edit({ importResult: true }); setPrompts(list); setResults({}); setGrades({}); setNotice({ kind: 'info', text: `Loaded ${list.length} prompts.${exampleId ? ' Run and Grade now use live providers.' : ''}` }); }); }
  function onCorpusFile(file) { readFile(file, 'corpus', text => { if (text.length > LIMITS.corpus) throw new Error('The reference corpus is limited to 30,000 characters.'); edit({ importResult: true }); setCorpus(text); setNotice({ kind: 'info', text: `Loaded ${file.name} (${text.length.toLocaleString()} characters).${exampleId ? ' Run and Grade now use live providers.' : ''}` }); }); }

  const corpusWarn = corpus.length > 12000;
  const busy = running || grading || loadingExample;
  const graderIssue = graderProblem(graderProvider, grader, graderKey);
  const canGrade = Boolean(exampleId) || !graderIssue;
  function chooseTab(next, focus = false) {
    setTab(next);
    if (focus) document.getElementById(`tab-${next}`)?.focus();
  }
  function tabKey(event) {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      chooseTab(event.key === 'Home' ? 'compare' : event.key === 'End' ? 'configure' : tab === 'compare' ? 'configure' : 'compare', true);
    }
  }

  return (
    <div className="shell">
      <h2 className="sr-only">Model Arena: compare small Hugging Face models on your prompts and grade them with your chosen provider</h2>
      <section className="workspace-intro">
        <div><span className="eyebrow">Compare · inspect · decide</span><h1>Put your models to the test.</h1><p className="sub">Use the same prompts and reference. Compare each answer, then inspect scores from your chosen grader.</p></div>
        <button className="btn primary" onClick={loadExample} disabled={busy} aria-busy={loadingExample}><FlaskConical aria-hidden="true" />{loadingExample ? 'Loading example…' : 'Try with an example'}</button>
      </section>
      <div className="workspace-status">
        <span className={`badge ${exampleId ? 'ok' : 'accent'}`}>{exampleId ? 'Prepared example · no provider calls' : config.providerMode === 'mock' ? 'Development mock · no provider calls' : 'Live comparison'}</span>
        <span className="hint">{exampleId ? 'Run all → Grade all → compare the scores. Editing any input switches to live mode.' : config.providerMode === 'mock' ? 'Development fixtures replace provider responses. Prepared scores are illustrative.' : 'Run uses Hugging Face. Grade uses your provider key and is billed directly by that provider. Each prompt adds a grading call.'}</span>
        {!exampleId && config.loaded && <span className="hint">{config.hf ? 'HF ready' : 'HF unavailable'} · {graderIssue ? 'Grader needs configuration' : `${graderProvider} key entered · not verified`}</span>}
      </div>

      <div className="workspace-tabs" role="tablist" aria-label="Workspace view">
        {['compare', 'configure'].map(value => <button key={value} id={`tab-${value}`} role="tab" className={`btn ${tab === value ? 'primary' : ''}`} aria-selected={tab === value} aria-controls={`panel-${value}`} tabIndex={tab === value ? 0 : -1} onKeyDown={tabKey} onClick={() => chooseTab(value)}>{value === 'compare' ? 'Compare' : 'Configure'}</button>)}
      </div>
      <section id="panel-configure" role="tabpanel" aria-labelledby="tab-configure" hidden={tab !== 'configure'} tabIndex={0} className="configure-panel card">
        <div className="cardhead"><h2>Configure your grader</h2><span className="badge">Your API key · this session only</span></div>
        <p>Choose who scores the answers. Your key stays in this page’s memory and is sent securely through our server only when you select Grade. It is cleared on reload, sign-out or provider change.</p>
        <div className="configure-fields">
          <div className="field"><label htmlFor="grader-provider">Provider</label><select id="grader-provider" value={graderProvider} disabled={busy} onChange={e => { edit({ gradesOnly: true }); setGraderProvider(e.target.value); setGrader(GRADER_PROVIDERS.find(p => p.id === e.target.value).models[0]); setGraderKey(''); setShowKey(false); }}>{GRADER_PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div className="field"><label htmlFor="grader-model">Model</label><select id="grader-model" value={grader} disabled={busy} onChange={e => { edit({ gradesOnly: true }); setGrader(e.target.value); }}>{GRADER_PROVIDERS.find(p => p.id === graderProvider).models.map(m => <option key={m} value={m}>{m}</option>)}</select></div>
          <div className="field key-field"><label htmlFor="grader-key">API key</label><input id="grader-key" name="arena-session-key" type={showKey ? 'text' : 'password'} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={4096} value={graderKey} disabled={busy} placeholder="Paste your provider API key" aria-describedby="grader-key-help" onChange={e => { setGraderKey(e.target.value); }} /><div className="actions"><button className="btn small" disabled={busy || !graderKey} aria-pressed={showKey} onClick={() => setShowKey(v => !v)}>{showKey ? 'Hide key' : 'Show key'}</button><button className="btn small" disabled={busy || !graderKey} onClick={() => { setGraderKey(''); setShowKey(false); }}>Clear key</button></div></div>
        </div>
        <p id="grader-key-help" className="hint">Keys are never saved in browser storage, exported, or stored in our database. Model access and key validity are checked by the provider on your first grading request; entering a key makes no provider call.</p>
        <p className="config-billing">Grading is charged to your provider account, outside the hosted generation allowance. Model Arena does not estimate its price. Each call sends the prompt, system prompt, reference corpus and anonymised answers to the selected provider. Review that provider’s data policies before sending sensitive material.</p>
        <p role="status" className={graderIssue ? 'hint' : 'configured-status'}>{graderIssue || `${graderProvider} key entered. Ready to request grading; key and account access are not yet verified.`}</p>
        <div className="actions"><button className="btn primary" onClick={() => chooseTab('compare', true)}>Back to comparison</button><span className="hint">Prepared examples work without any key.</span></div>
      </section>
      <div id="panel-compare" role="tabpanel" aria-labelledby="tab-compare" hidden={tab !== 'compare'} tabIndex={0} className="layout">
        <aside className="side">
          <section className="card">
            <div className="cardhead"><h2>Models</h2><button className="btn small" onClick={refreshModels} disabled={busy}><RefreshCw aria-hidden="true" />Refresh list</button></div>
            <datalist id="model-list">{available.map((m) => <option key={m.id} value={m.id} label={m.funded ? `Priced route · ${m.routeProvider}` : "Price unverified · unavailable for included allowance"} />)}</datalist>
            {models.map((m, i) => (
              <div className="slot" key={i}>
                <input type="text" id={`model-${i}`} aria-label={`Model ${i + 1}`} maxLength={160} list="model-list" className="mono" placeholder={i === 0 ? "org/model-id from Hugging Face" : "optional"} value={m}
                  onChange={(e) => { edit(); setModels((prev) => prev.map((x, k) => (k === i ? e.target.value : x))); }} disabled={busy} />
                <button className="btn small icon" aria-label={`Clear model ${i + 1}`} onClick={() => { edit(); setModels((prev) => prev.map((x, k) => (k === i ? "" : x))); }} disabled={busy}><X aria-hidden="true" /></button>
              </div>
            ))}
            <p className="hint" style={{ margin: "6px 0" }}>Small instruct models with a current verified route price:</p>
            <div className="chips">
              {smallModels.length ? smallModels.slice(0, 14).map((id) => (
                <button key={id} className="chip" disabled={busy} onClick={() => { edit(); setModels((prev) => { if (prev.includes(id)) return prev; const k = prev.findIndex((x) => !x.trim()); if (k < 0) return prev; return prev.map((x, j) => (j === k ? id : x)); }); }}>{id.split("/").pop()}</button>
              )) : <span className="count">{available.length ? "no priced small models" : "loading…"}</span>}
            </div>
            <p className="count" style={{ marginTop: 8 }}>{available.filter(m => m.funded).length} priced routes · {available.length} catalog models</p>
            <p className="hint">Only routes with a verified price can use the included allowance. You can still enter a model ID manually.</p>
          </section>

          <section className="card">
            <div className="cardhead"><h2>System prompt</h2><button className="btn small" onClick={() => { edit(); setSystem(DEFAULT_SYSTEM); }} disabled={busy}>Reset</button></div>
            <textarea id="system-prompt" aria-label="System prompt" maxLength={LIMITS.system} rows={5} value={system} onChange={(e) => { edit(); setSystem(e.target.value); }} disabled={busy} />
          </section>

          <section className="card">
            <div className="cardhead"><h2>Reference corpus</h2>
              <div className="actions">
                <label className="btn small filelabel">Upload .txt / .md / .json<input type="file" accept=".txt,.md,.json,.csv" onChange={(e) => e.target.files?.[0] && onCorpusFile(e.target.files[0])} disabled={busy} /></label>
                <button className="btn small" onClick={() => { edit(); setCorpus(""); }} disabled={busy || !corpus}>Clear</button>
              </div>
            </div>
            <textarea id="corpus" aria-label="Reference corpus" maxLength={LIMITS.corpus} rows={7} className="mono" placeholder="Paste the text the models must answer from. Leave empty for closed-book answers." value={corpus} onChange={(e) => { edit(); setCorpus(e.target.value); }} disabled={busy} />
            <div className="field" style={{ marginTop: 8 }}>
              <label>Where it goes <span className="count">{corpus.length.toLocaleString()} chars ≈ {Math.round(corpus.length / 4).toLocaleString()} tokens</span></label>
              <div className="radios">
                <label><input type="radio" name="placement" checked={placement === "user"} onChange={() => { edit(); setPlacement("user"); }} disabled={busy} /> user message, as a supplied reference</label>
                <label><input type="radio" name="placement" checked={placement === "system"} onChange={() => { edit(); setPlacement("system"); }} disabled={busy} /> appended to the system prompt</label>
              </div>
              {corpusWarn && <span className="hint" style={{ color: "var(--warn)" }}>Large corpus: every call sends all of it, and the grader reads up to 30,000 characters of it.</span>}
            </div>
          </section>

          <section className="card">
            <div className="cardhead"><h2>Decoding</h2></div>
            <div className="field"><label htmlFor="max-tokens">Max new tokens <span className="count">{maxTokens}</span></label><input type="range" id="max-tokens" min="32" max="1024" step="1" value={maxTokens} onChange={(e) => { edit(); setMaxTokens(+e.target.value); }} disabled={busy} /></div>
            <div className="field"><label htmlFor="temperature">Temperature <span className="count">{temperature.toFixed(1)}</span></label><input type="range" id="temperature" min="0" max="1.5" step="0.1" value={temperature} onChange={(e) => { edit(); setTemperature(+e.target.value); }} disabled={busy} /><span className="hint">Lower temperature reduces variation; identical responses are not guaranteed.</span></div>
          </section>

          <section className="card">
            <div className="cardhead"><h2>Grader</h2></div>
            <p className="mono">{exampleId ? 'Prepared example grader' : grader}</p>
            <p className="hint">Scores accuracy, helpfulness and format from 1 to 10. Answers are shuffled and anonymised. Scores are judgments, not ground truth.</p>
            {!exampleId && <p className="hint">{graderIssue ? 'Add your API key before grading.' : 'Key entered · billed by your provider'}</p>}
            <button className="btn" onClick={() => chooseTab('configure', true)}>Configure grader</button>
          </section>
        </aside>

        <main className="main">
          <section className="card">
            <div className="cardhead"><h2>Prompts <span className="count">{prompts.length}</span></h2>
              <div className="actions">
                <button className="btn small" onClick={() => { const id = uid(); edit({ promptId: id }); setPrompts((p) => [...p, { id, prompt: "", reference: "" }]); }} disabled={busy || prompts.length >= LIMITS.prompts}><Plus aria-hidden="true" />Add prompt</button>
                <label className="btn small filelabel">Upload JSON<input type="file" accept=".json" onChange={(e) => e.target.files?.[0] && onPromptFile(e.target.files[0])} disabled={busy} /></label>
                <button className="btn small" onClick={() => { edit(); setPrompts(SAMPLE_PROMPTS.map((p, i) => ({ id: `sample-${i + 1}`, ...p }))); setResults({}); setGrades({}); }} disabled={busy}>Load samples</button>
                <button className="btn small danger" onClick={() => { edit(); setPrompts([]); setResults({}); setGrades({}); }} disabled={busy}>Clear all</button>
              </div>
            </div>
            {prompts.length === 0 && <p className="empty-state">No prompts yet. Add one, load the samples, or upload a JSON file: an array of strings, or objects with prompt and optional reference fields.</p>}
            {prompts.map((p, i) => (
              <div className="promptrow" key={p.id}>
                <span className="idx">{i + 1}</span>
                <div>
                  <textarea id={`prompt-${p.id}`} aria-label={`Prompt ${i + 1}`} maxLength={LIMITS.prompt} placeholder="Prompt" value={p.prompt} onChange={(e) => { edit({ promptId: p.id }); setPrompts((prev) => prev.map((x) => (x.id === p.id ? { ...x, prompt: e.target.value } : x))); }} disabled={busy} />
                  <input type="text" className="ref" id={`ref-${p.id}`} aria-label={`Reference answer ${i + 1}`} maxLength={LIMITS.reference} placeholder="Reference answer for the grader (optional)" value={p.reference || ""} onChange={(e) => { edit({ promptId: p.id, gradesOnly: true }); setPrompts((prev) => prev.map((x) => (x.id === p.id ? { ...x, reference: e.target.value } : x))); }} disabled={busy} />
                </div>
                <button className="btn small icon" aria-label={`Remove prompt ${i + 1}`} onClick={() => { edit({ promptId: p.id }); setPrompts((prev) => prev.filter((x) => x.id !== p.id)); }} disabled={busy}><X aria-hidden="true" /></button>
              </div>
            ))}
          </section>

          <section className="card">
            <div className="cardhead"><h2>Results</h2>
              <div className="actions">
                <button className="btn primary" onClick={() => runAll()} disabled={busy}><Play aria-hidden="true" />{running ? "Running…" : "Run all"}</button>
                {running && <button className="btn" onClick={() => { stopRef.current = true; }}><Square aria-hidden="true" />Stop after current</button>}
                <button className="btn" onClick={gradeAll} disabled={busy || !canGrade}>{grading ? "Grading…" : "Grade all"}</button>
                <button className="btn" onClick={exportJson} disabled={!Object.keys(results).length}><Download aria-hidden="true" />Export JSON</button>
                <button className="btn" onClick={exportCsv} disabled={!Object.keys(results).length}><Download aria-hidden="true" />Export CSV</button>
                <button className="btn danger" onClick={() => { setResults({}); setGrades({}); }} disabled={busy || !Object.keys(results).length}><Trash2 aria-hidden="true" />Clear results</button>
              </div>
            </div>
            {!activeModels.length ? <p className="empty-state">Pick at least one model on the left.</p> : (
              <div className="tablewrap" tabIndex={0} aria-label="Side-by-side model answers">
                <table className="results">
                  <thead><tr><th className="pcol">Prompt</th>{activeModels.map((m) => <th key={m}><span className="mono">{m}</span></th>)}</tr></thead>
                  <tbody>
                    {prompts.filter((p) => p.prompt.trim()).map((p) => {
                      const g = grades[p.id];
                      return (
                        <tr key={p.id}>
                          <td className="pcol"><div className="pcell">{p.prompt}{p.reference ? <div className="ref">Reference: {p.reference}</div> : null}
                            <div className="rowbtns">
                              <button className="btn small" onClick={() => runAll(p.id)} disabled={busy}>Run</button>
                              <button className="btn small" onClick={() => gradeSingle(p)} disabled={busy || !rowDone(p) || !canGrade}>Grade</button>
                              {g?.status === "running" && <span className="badge accent">grading…</span>}
                              {g?.status === "error" && <button className="badge bad" aria-controls={`grade-error-${encodeURIComponent(p.id)}`} onClick={() => { const target = document.getElementById(`grade-error-${encodeURIComponent(p.id)}`); target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: 'nearest' }); }}>Grading failed · Details</button>}
                              {g?.status === "done" && <span className="badge ok">{g.cached ? "Prepared grade · no provider" : `graded by ${g.grader}`}</span>}
                            </div>
                          </div></td>
                          {activeModels.map((m) => {
                            const r = results[ck(p.id, m)]; const s = g?.status === "done" ? g.scores?.[m] : null;
                            return (
                              <td key={m}><div className="cell">
                                <div className="meta">
                                  {!r && <span className="badge">not run</span>}
                                  {r?.status === "stopped" && <span className="badge">stopped before dispatch</span>}
                                  {r?.cached && <span className="badge">Prepared answer · no provider</span>}
                                  {r?.status === "queued" && <span className="badge">queued</span>}
                                  {r?.status === "running" && <span className="badge accent">running…</span>}
                                  {r?.status === "error" && <span className="badge bad">error</span>}
                                  {r?.status === "done" && <><span className="badge ok">{fmtMs(r.ms)}</span>{r.usage?.completion_tokens != null && <span>{r.usage.completion_tokens} tokens</span>}{r.finish && r.finish !== "stop" && <span className="badge warn">{r.finish}</span>}{r.attempts > 1 && <span>{r.attempts} attempts</span>}</>}
                                  {g?.status === "done" && g.best === m && <span className="badge accent">best</span>}
                                </div>
                                {r?.status === "done" && finishWarning(r.finish) && <p className="answer-warning">{finishWarning(r.finish)}</p>}
                                {r?.status === "done" && <div className={`resp${r.text ? "" : " empty"}`}>{r.text || "empty answer"}</div>}
                                {r?.status === "error" && <div className="resp empty">{r.error}</div>}
                                {s && <div className="scores"><span className="score big">{s.overall}</span><span className="score">acc {s.accuracy}</span><span className="score">help {s.helpfulness}</span><span className="score">fmt {s.format}</span></div>}
                                {s?.reason && <div className="reason">{s.reason}</div>}
                              </div></td>
                            );
                          })}
                        </tr>

                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="grade-errors">
              {prompts.map((p, index) => { const failure = grades[p.id]; return failure?.status === 'error' ? <div key={p.id} id={`grade-error-${encodeURIComponent(p.id)}`} tabIndex={-1} className="grade-error" role="alert">
                <p><strong>Grading failed · Prompt {index + 1}</strong></p><p className="hint">{p.prompt.length > 160 ? `${p.prompt.slice(0, 160)}…` : p.prompt}</p><p>{failure.error}</p>
                <p>Your model answers are preserved. A failed provider request may still be charged. Retry only when ready.</p>
                <button className="btn small" onClick={() => chooseTab('configure', true)}>Configure grader</button>{failure.requestId && <p className="hint">Support reference: {failure.requestId}</p>}
              </div> : null; })}
            </div>
          </section>

          <section className="card">
            <div className="cardhead"><h2>Summary</h2><span className="count">averages over graded prompts · {Object.values(grades).filter(g => g?.status === "error").length} grading failures</span></div>
            {!activeModels.length ? <p className="empty-state">Nothing to summarise yet.</p> : (
              <div className="tablewrap" tabIndex={0} aria-label="Model score summary"><table className="summary">
                <thead><tr><th>model</th><th className="n">graded</th><th className="n">accuracy</th><th className="n">helpfulness</th><th className="n">format</th><th className="n">overall</th><th className="n">wins</th><th className="n">run errors</th><th className="n">avg latency</th></tr></thead>
                <tbody>{summary.map((s) => (
                  <tr key={s.model}><td className="mono">{s.model}</td><td className="n">{s.graded}</td><td className="n">{s.accuracy}</td><td className="n">{s.helpfulness}</td><td className="n">{s.format}</td><td className="n">{s.overall}</td><td className="n">{s.wins}</td><td className="n">{s.errors}</td><td className="n">{s.avgMs != null ? fmtMs(s.avgMs) : "–"}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
        </main>
      </div>

      {notice && <div role={notice.kind === "error" ? "alert" : "status"} className={`toast ${notice.kind === "error" ? "error" : ""}`}>{notice.text}{notice.kind === "error" && <button className="btn small" onClick={() => setNotice(null)} aria-label="Dismiss notification">Dismiss</button>}</div>}
    </div>
  );
}
