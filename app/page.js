"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "model-arena:v1";
const DEFAULT_SYSTEM = "You are a helpful assistant. Answer clearly with specific reasons. If a reference is supplied, use only the reference and say when it does not contain the answer.";
const DEFAULT_MODELS = ["Qwen/Qwen3-4B-Instruct-2507", "meta-llama/Llama-3.1-8B-Instruct", ""];
const SAMPLE_PROMPTS = [
  { prompt: "Which is the best Avengers movie and why?", reference: "" },
  { prompt: "Recommend a romantic movie. Give three distinct reasons and one caveat, under 120 words.", reference: "" },
  { prompt: "Who directed Inception (2010)? Answer with the name only.", reference: "Christopher Nolan" },
];
const GRADER_FALLBACK = ["gemini-3.1-pro-preview", "gemini-pro-latest", "gemini-2.5-pro"];
const CONCURRENCY = 3;
const GRADE_CONCURRENCY = 2;

const uid = () => Math.random().toString(36).slice(2, 10);
const ck = (pid, model) => `${pid}|${model}`;
const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);

function parsePromptFile(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : Array.isArray(data.prompts) ? data.prompts : null;
  if (!list) throw new Error("Expected a JSON array, or an object with a \"prompts\" array.");
  return list.map((item) => {
    if (typeof item === "string") return { id: uid(), prompt: item, reference: "" };
    const prompt = item.prompt ?? item.question ?? item.input ?? item.text ?? item.user ?? "";
    const reference = item.reference ?? item.reference_answer ?? item.answer ?? item.expected ?? "";
    if (!String(prompt).trim()) throw new Error("Every item needs a prompt, question, input or text field.");
    return { id: String(item.id || uid()), prompt: String(prompt), reference: String(reference || "") };
  });
}

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvEscape(v) { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

export default function Page() {
  const [loaded, setLoaded] = useState(false);
  const [config, setConfig] = useState({ needsKey: false, hf: true, gemini: true });
  const [accessKey, setAccessKey] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [keyOk, setKeyOk] = useState(true);
  const [available, setAvailable] = useState([]);
  const [graders, setGraders] = useState(GRADER_FALLBACK);
  const [models, setModels] = useState(DEFAULT_MODELS);
  const [system, setSystem] = useState(DEFAULT_SYSTEM);
  const [corpus, setCorpus] = useState("");
  const [placement, setPlacement] = useState("user");
  const [maxTokens, setMaxTokens] = useState(300);
  const [temperature, setTemperature] = useState(0);
  const [grader, setGrader] = useState(GRADER_FALLBACK[0]);
  const [prompts, setPrompts] = useState(() => SAMPLE_PROMPTS.map((p) => ({ id: uid(), ...p })));
  const [results, setResults] = useState({});
  const [grades, setGrades] = useState({});
  const [running, setRunning] = useState(false);
  const [grading, setGrading] = useState(false);
  const [notice, setNotice] = useState(null);
  const stopRef = useRef(false);

  const activeModels = useMemo(() => models.map((m) => m.trim()).filter(Boolean).filter((m, i, a) => a.indexOf(m) === i), [models]);
  const smallModels = useMemo(() => available.filter((m) => m.small).map((m) => m.id), [available]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved) {
        if (saved.accessKey) { setAccessKey(saved.accessKey); setKeyDraft(saved.accessKey); }
        if (Array.isArray(saved.models)) setModels([...saved.models, "", "", ""].slice(0, 3));
        if (typeof saved.system === "string") setSystem(saved.system);
        if (typeof saved.corpus === "string") setCorpus(saved.corpus);
        if (saved.placement) setPlacement(saved.placement);
        if (saved.maxTokens) setMaxTokens(saved.maxTokens);
        if (typeof saved.temperature === "number") setTemperature(saved.temperature);
        if (saved.grader) setGrader(saved.grader);
        if (Array.isArray(saved.prompts) && saved.prompts.length) setPrompts(saved.prompts);
        if (saved.results) setResults(saved.results);
        if (saved.grades) setGrades(saved.grades);
      }
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ accessKey, models, system, corpus, placement, maxTokens, temperature, grader, prompts, results, grades })); } catch {}
  }, [loaded, accessKey, models, system, corpus, placement, maxTokens, temperature, grader, prompts, results, grades]);

  const api = useCallback(async (path, opts = {}) => {
    const headers = { "Content-Type": "application/json", ...(accessKey ? { "x-app-key": accessKey } : {}) };
    const r = await fetch(path, { ...opts, headers });
    let j = null; try { j = await r.json(); } catch {}
    if (r.status === 401) { setKeyOk(false); throw new Error("Access key required, or the key is wrong."); }
    if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
    return j;
  }, [accessKey]);

  useEffect(() => {
    if (!loaded) return;
    fetch("/api/config").then((r) => r.json()).then((c) => { setConfig(c); if (c.needsKey && !accessKey) setKeyOk(false); }).catch(() => {});
  }, [loaded, accessKey]);

  const refreshModels = useCallback(async () => {
    try {
      const [m, g] = await Promise.all([api("/api/models"), api("/api/grader-models")]);
      setAvailable(m.models || []);
      if (g.models?.length) { setGraders(g.models); setGrader((cur) => (g.models.includes(cur) ? cur : g.models[0])); }
      setKeyOk(true);
    } catch (e) { setNotice({ kind: "error", text: e.message }); }
  }, [api]);

  useEffect(() => { if (loaded && keyOk && (!config.needsKey || accessKey)) refreshModels(); }, [loaded, keyOk, config.needsKey, accessKey, refreshModels]);

  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 6000); return () => clearTimeout(t); }, [notice]);

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

  async function runOne(p, m) {
    setResults((prev) => ({ ...prev, [ck(p.id, m)]: { status: "running" } }));
    try {
      const j = await api("/api/generate", { method: "POST", body: JSON.stringify({ model: m, messages: buildMessages(p.prompt), max_tokens: maxTokens, temperature }) });
      setResults((prev) => ({ ...prev, [ck(p.id, m)]: { status: "done", ...j } }));
    } catch (e) {
      setResults((prev) => ({ ...prev, [ck(p.id, m)]: { status: "error", error: e.message } }));
    }
  }

  async function runAll(onlyId = null) {
    if (!activeModels.length) return setNotice({ kind: "error", text: "Pick at least one model." });
    const targets = prompts.filter((p) => p.prompt.trim() && (!onlyId || p.id === onlyId));
    if (!targets.length) return setNotice({ kind: "error", text: "Add at least one prompt." });
    const jobs = []; for (const p of targets) for (const m of activeModels) jobs.push({ p, m });
    setRunning(true); stopRef.current = false;
    setResults((prev) => { const n = { ...prev }; for (const { p, m } of jobs) n[ck(p.id, m)] = { status: "queued" }; return n; });
    setGrades((prev) => { const n = { ...prev }; for (const p of targets) delete n[p.id]; return n; });
    let i = 0;
    const worker = async () => { while (i < jobs.length && !stopRef.current) { const job = jobs[i++]; await runOne(job.p, job.m); } };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
    setRunning(false);
  }

  function rowDone(p) { return activeModels.length > 0 && activeModels.every((m) => results[ck(p.id, m)]?.status === "done"); }

  async function gradeRow(p) {
    const responses = activeModels.map((m) => ({ model: m, text: results[ck(p.id, m)]?.text })).filter((r) => typeof r.text === "string");
    if (!responses.length) return;
    setGrades((prev) => ({ ...prev, [p.id]: { status: "running" } }));
    try {
      const j = await api("/api/grade", { method: "POST", body: JSON.stringify({ grader, prompt: p.prompt, reference: p.reference || "", corpus, systemPrompt: system, responses }) });
      setGrades((prev) => ({ ...prev, [p.id]: { status: "done", ...j } }));
    } catch (e) {
      setGrades((prev) => ({ ...prev, [p.id]: { status: "error", error: e.message } }));
    }
  }

  async function gradeAll() {
    const targets = prompts.filter(rowDone);
    if (!targets.length) return setNotice({ kind: "error", text: "Run the prompts first; grading needs every model's answer for a row." });
    setGrading(true);
    let i = 0;
    const worker = async () => { while (i < targets.length) { const p = targets[i++]; await gradeRow(p); } };
    await Promise.all(Array.from({ length: Math.min(GRADE_CONCURRENCY, targets.length) }, worker));
    setGrading(false);
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
    download(`model-arena-${new Date().toISOString().slice(0, 19)}.json`, JSON.stringify({
      exportedAt: new Date().toISOString(), settings: { models: activeModels, system, corpusChars: corpus.length, placement, maxTokens, temperature, grader },
      prompts, results, grades, summary,
    }, null, 2), "application/json");
  }
  function exportCsv() {
    const rows = [["prompt_id", "prompt", "reference", "model", "status", "response", "latency_ms", "completion_tokens", "accuracy", "helpfulness", "format", "overall", "best", "grader_reason"]];
    for (const p of prompts) for (const m of activeModels) {
      const r = results[ck(p.id, m)] || {}; const g = grades[p.id]; const s = g?.status === "done" ? g.scores?.[m] : null;
      rows.push([p.id, p.prompt, p.reference || "", m, r.status || "", r.text || r.error || "", r.ms ?? "", r.usage?.completion_tokens ?? "", s?.accuracy ?? "", s?.helpfulness ?? "", s?.format ?? "", s?.overall ?? "", g?.best === m ? "yes" : "", s?.reason ?? ""]);
    }
    download(`model-arena-${new Date().toISOString().slice(0, 19)}.csv`, rows.map((r) => r.map(csvEscape).join(",")).join("\n"), "text/csv");
  }

  function onPromptFile(file) {
    const reader = new FileReader();
    reader.onload = () => { try { const list = parsePromptFile(String(reader.result)); setPrompts(list); setNotice({ kind: "info", text: `Loaded ${list.length} prompts.` }); } catch (e) { setNotice({ kind: "error", text: e.message }); } };
    reader.readAsText(file);
  }
  function onCorpusFile(file) {
    const reader = new FileReader();
    reader.onload = () => { setCorpus(String(reader.result)); setNotice({ kind: "info", text: `Loaded ${file.name} (${String(reader.result).length.toLocaleString()} characters).` }); };
    reader.readAsText(file);
  }

  const corpusWarn = corpus.length > 12000;
  const busy = running || grading;

  return (
    <div className="shell">
      <h2 className="sr-only">Model Arena: compare small Hugging Face models on your prompts and grade them with Gemini</h2>
      <header className="top">
        <div>
          <h1>Model Arena</h1>
          <p className="sub">Run up to three Hugging Face models on the same prompts, with your system prompt and reference corpus, then let Gemini grade them.</p>
        </div>
        <div className="status">
          <span className={`badge ${config.hf ? "ok" : "bad"}`}>HF token {config.hf ? "set" : "missing"}</span>
          <span className={`badge ${config.gemini ? "ok" : "bad"}`}>Gemini key {config.gemini ? "set" : "missing"}</span>
          <span className={`badge ${config.needsKey ? "accent" : "warn"}`}>{config.needsKey ? "Access key on" : "No access key: anyone with the URL can spend your quota"}</span>
        </div>
      </header>

      {!keyOk && (
        <section className="card keycard" style={{ marginBottom: 16 }}>
          <div className="cardhead"><h2>Access key</h2></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input type="text" id="access-key" placeholder="Paste the APP_ACCESS_KEY set on the server" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} style={{ maxWidth: 420 }} />
            <button className="btn primary" onClick={() => { setAccessKey(keyDraft.trim()); setKeyOk(true); }}>Unlock</button>
          </div>
        </section>
      )}

      <div className="layout">
        <aside className="side">
          <section className="card">
            <div className="cardhead"><h2>Models</h2><button className="btn small" onClick={refreshModels} disabled={busy}>Refresh list</button></div>
            <datalist id="model-list">{available.map((m) => <option key={m.id} value={m.id} />)}</datalist>
            {models.map((m, i) => (
              <div className="slot" key={i}>
                <input type="text" id={`model-${i}`} list="model-list" className="mono" placeholder={i === 0 ? "org/model-id from Hugging Face" : "optional"} value={m}
                  onChange={(e) => setModels((prev) => prev.map((x, k) => (k === i ? e.target.value : x)))} disabled={busy} />
                <button className="btn small" title="Clear" onClick={() => setModels((prev) => prev.map((x, k) => (k === i ? "" : x)))} disabled={busy}>×</button>
              </div>
            ))}
            <p className="hint" style={{ margin: "6px 0" }}>Suggested small instruct models available on the router right now:</p>
            <div className="chips">
              {smallModels.length ? smallModels.slice(0, 14).map((id) => (
                <button key={id} className="chip" disabled={busy} onClick={() => setModels((prev) => { if (prev.includes(id)) return prev; const k = prev.findIndex((x) => !x.trim()); if (k < 0) return prev; return prev.map((x, j) => (j === k ? id : x)); })}>{id.split("/").pop()}</button>
              )) : <span className="count">{available.length ? "none flagged small" : "loading…"}</span>}
            </div>
            <p className="count" style={{ marginTop: 8 }}>{available.length} models on the Hugging Face router</p>
          </section>

          <section className="card">
            <div className="cardhead"><h2>System prompt</h2><button className="btn small" onClick={() => setSystem(DEFAULT_SYSTEM)} disabled={busy}>Reset</button></div>
            <textarea id="system-prompt" rows={5} value={system} onChange={(e) => setSystem(e.target.value)} disabled={busy} />
          </section>

          <section className="card">
            <div className="cardhead"><h2>Reference corpus</h2>
              <div className="actions">
                <label className="btn small filelabel">Upload .txt / .md / .json<input type="file" accept=".txt,.md,.json,.csv" onChange={(e) => e.target.files?.[0] && onCorpusFile(e.target.files[0])} disabled={busy} /></label>
                <button className="btn small" onClick={() => setCorpus("")} disabled={busy || !corpus}>Clear</button>
              </div>
            </div>
            <textarea id="corpus" rows={7} className="mono" placeholder="Paste the text the models must answer from. Leave empty for closed-book answers." value={corpus} onChange={(e) => setCorpus(e.target.value)} disabled={busy} />
            <div className="field" style={{ marginTop: 8 }}>
              <label>Where it goes <span className="count">{corpus.length.toLocaleString()} chars ≈ {Math.round(corpus.length / 4).toLocaleString()} tokens</span></label>
              <div className="radios">
                <label><input type="radio" name="placement" checked={placement === "user"} onChange={() => setPlacement("user")} disabled={busy} /> user message, as a supplied reference</label>
                <label><input type="radio" name="placement" checked={placement === "system"} onChange={() => setPlacement("system")} disabled={busy} /> appended to the system prompt</label>
              </div>
              {corpusWarn && <span className="hint" style={{ color: "var(--warn)" }}>Large corpus: every call sends all of it, and the grader reads up to 30,000 characters of it.</span>}
            </div>
          </section>

          <section className="card">
            <div className="cardhead"><h2>Decoding</h2></div>
            <div className="field"><label>Max new tokens <span className="count">{maxTokens}</span></label><input type="range" id="max-tokens" min="32" max="1024" step="16" value={maxTokens} onChange={(e) => setMaxTokens(+e.target.value)} disabled={busy} /></div>
            <div className="field"><label>Temperature <span className="count">{temperature.toFixed(1)}</span></label><input type="range" id="temperature" min="0" max="1.5" step="0.1" value={temperature} onChange={(e) => setTemperature(+e.target.value)} disabled={busy} /><span className="hint">0 is greedy and repeatable; use it for comparisons.</span></div>
          </section>

          <section className="card">
            <div className="cardhead"><h2>Grader</h2></div>
            <div className="field"><label>Gemini model</label>
              <select id="grader" value={grader} onChange={(e) => setGrader(e.target.value)} disabled={busy}>{graders.map((g) => <option key={g} value={g}>{g}</option>)}</select>
              <span className="hint">Scores accuracy, helpfulness and format from 1 to 10, then names the best. Answers are shuffled and anonymised before grading.</span>
            </div>
          </section>
        </aside>

        <main className="main">
          <section className="card">
            <div className="cardhead"><h2>Prompts <span className="count">{prompts.length}</span></h2>
              <div className="actions">
                <button className="btn small" onClick={() => setPrompts((p) => [...p, { id: uid(), prompt: "", reference: "" }])} disabled={busy}>Add prompt</button>
                <label className="btn small filelabel">Upload JSON<input type="file" accept=".json" onChange={(e) => e.target.files?.[0] && onPromptFile(e.target.files[0])} disabled={busy} /></label>
                <button className="btn small" onClick={() => setPrompts(SAMPLE_PROMPTS.map((p) => ({ id: uid(), ...p })))} disabled={busy}>Load samples</button>
                <button className="btn small danger" onClick={() => { setPrompts([]); setResults({}); setGrades({}); }} disabled={busy}>Clear all</button>
              </div>
            </div>
            {prompts.length === 0 && <p className="empty-state">No prompts yet. Add one, load the samples, or upload a JSON file: an array of strings, or objects with prompt and optional reference fields.</p>}
            {prompts.map((p, i) => (
              <div className="promptrow" key={p.id}>
                <span className="idx">{i + 1}</span>
                <div>
                  <textarea id={`prompt-${p.id}`} placeholder="Prompt" value={p.prompt} onChange={(e) => setPrompts((prev) => prev.map((x) => (x.id === p.id ? { ...x, prompt: e.target.value } : x)))} disabled={busy} />
                  <input type="text" className="ref" id={`ref-${p.id}`} placeholder="Reference answer for the grader (optional)" value={p.reference || ""} onChange={(e) => setPrompts((prev) => prev.map((x) => (x.id === p.id ? { ...x, reference: e.target.value } : x)))} disabled={busy} />
                </div>
                <button className="btn small" title="Remove" onClick={() => { setPrompts((prev) => prev.filter((x) => x.id !== p.id)); }} disabled={busy}>×</button>
              </div>
            ))}
          </section>

          <section className="card">
            <div className="cardhead"><h2>Results</h2>
              <div className="actions">
                <button className="btn primary" onClick={() => runAll()} disabled={busy}>{running ? "Running…" : "Run all"}</button>
                {running && <button className="btn" onClick={() => { stopRef.current = true; }}>Stop after current</button>}
                <button className="btn" onClick={gradeAll} disabled={busy}>{grading ? "Grading…" : "Grade all"}</button>
                <button className="btn" onClick={exportJson} disabled={!Object.keys(results).length}>Export JSON</button>
                <button className="btn" onClick={exportCsv} disabled={!Object.keys(results).length}>Export CSV</button>
                <button className="btn danger" onClick={() => { setResults({}); setGrades({}); }} disabled={busy || !Object.keys(results).length}>Clear results</button>
              </div>
            </div>
            {!activeModels.length ? <p className="empty-state">Pick at least one model on the left.</p> : (
              <div className="tablewrap">
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
                              <button className="btn small" onClick={() => gradeRow(p)} disabled={busy || !rowDone(p)}>Grade</button>
                              {g?.status === "running" && <span className="badge accent">grading…</span>}
                              {g?.status === "error" && <span className="badge bad" title={g.error}>grader error</span>}
                              {g?.status === "done" && <span className="badge ok">graded by {g.grader}</span>}
                            </div>
                          </div></td>
                          {activeModels.map((m) => {
                            const r = results[ck(p.id, m)]; const s = g?.status === "done" ? g.scores?.[m] : null;
                            return (
                              <td key={m}><div className="cell">
                                <div className="meta">
                                  {!r && <span className="badge">not run</span>}
                                  {r?.status === "queued" && <span className="badge">queued</span>}
                                  {r?.status === "running" && <span className="badge accent">running…</span>}
                                  {r?.status === "error" && <span className="badge bad">error</span>}
                                  {r?.status === "done" && <><span className="badge ok">{fmtMs(r.ms)}</span>{r.usage?.completion_tokens != null && <span>{r.usage.completion_tokens} tokens</span>}{r.finish && r.finish !== "stop" && <span className="badge warn">{r.finish}</span>}{r.attempts > 1 && <span>{r.attempts} attempts</span>}</>}
                                  {g?.status === "done" && g.best === m && <span className="badge accent">best</span>}
                                </div>
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
          </section>

          <section className="card">
            <div className="cardhead"><h2>Summary</h2><span className="count">averages over graded prompts</span></div>
            {!activeModels.length ? <p className="empty-state">Nothing to summarise yet.</p> : (
              <table className="summary">
                <thead><tr><th>model</th><th className="n">graded</th><th className="n">accuracy</th><th className="n">helpfulness</th><th className="n">format</th><th className="n">overall</th><th className="n">wins</th><th className="n">errors</th><th className="n">avg latency</th></tr></thead>
                <tbody>{summary.map((s) => (
                  <tr key={s.model}><td className="mono">{s.model}</td><td className="n">{s.graded}</td><td className="n">{s.accuracy}</td><td className="n">{s.helpfulness}</td><td className="n">{s.format}</td><td className="n">{s.overall}</td><td className="n">{s.wins}</td><td className="n">{s.errors}</td><td className="n">{s.avgMs != null ? fmtMs(s.avgMs) : "–"}</td></tr>
                ))}</tbody>
              </table>
            )}
          </section>
        </main>
      </div>

      {notice && <div className={`toast ${notice.kind === "error" ? "error" : ""}`}>{notice.text}</div>}
    </div>
  );
}
