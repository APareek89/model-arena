import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientSession, ownerStorageKey, scrubLegacyAccessKey, performAuth } from '../app/client/session.mjs';
import { csvEscape, parsePromptFile, readWorkspace, runQueue, invalidateComparison } from '../app/client/workspace.mjs';
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
const user = id => ({ enabled: true, user: { id }, csrf_token: `csrf-${id}` });
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

test('old-owner 401 cannot expire the next account; same-owner refresh keeps valid requests', async () => {
  const pending = defer(); let expired = 0;
  const client = createClientSession(() => pending.promise, () => expired++);
  client.accept(user('A')); const epoch = client.capture(); const request = client.request('/api/generate');
  client.accept(user('B')); pending.resolve(response({ error: 'Expired' }, 401));
  await assert.rejects(request, { name: 'AbortError' }); assert.equal(expired, 0); assert.equal(client.current(epoch), false);
  const next = client.capture(); client.accept(user('B')); assert.equal(client.current(next), true);
});

test('current-owner 401 expires once; A→out→A invalidates old operations', async () => {
  let expired = 0; const client = createClientSession(async () => response({}, 401), () => expired++);
  client.accept(user('A')); const epoch = client.capture(); await assert.rejects(client.request('/api/grade'), { name: 'AbortError' });
  assert.equal(expired, 1); client.accept(user('A')); assert.equal(client.current(epoch), false);
});

test('identity change during JSON body parsing blocks old response and imported/export callback epoch', async () => {
  const body = defer(); const client = createClientSession(async () => ({ ok: true, json: () => body.promise }));
  client.accept(user('A')); const epoch = client.capture(); const result = client.request('/api/models');
  await Promise.resolve(); client.accept(user('B')); body.resolve({ models: ['private-A'] });
  await assert.rejects(result, { name: 'AbortError' }); assert.throws(() => client.assert(epoch), { name: 'AbortError' });
});

test('app mutation uses reusable session CSRF and retains abort signal', async () => {
  const controller = new AbortController(); let sent;
  const client = createClientSession(async (_, opts) => { sent = opts; return response({ ok: true }); });
  client.accept(user('A')); await client.request('/api/generate', { method: 'POST', signal: controller.signal, body: '{}' });
  assert.equal(sent.headers.get('X-CSRF-Token'), 'csrf-A'); assert.equal(sent.signal, controller.signal); assert.equal(sent.credentials, 'same-origin');
});

test('three-worker queue stops scheduling on account change but lets in-flight calls settle', async () => {
  const barriers = [defer(), defer(), defer()]; const started = []; let current = true;
  const run = runQueue([0,1,2,3,4,5], 3, async i => { started.push(i); await barriers[i].promise; }, () => current);
  assert.deepEqual(started, [0,1,2]); current = false; barriers.forEach(b => b.resolve()); await run;
  assert.deepEqual(started, [0,1,2]);
});

test('NextAuth v5 requests return-redirect JSON and rejects bad credentials/HTML masquerading as success', async () => {
  let posted;
  const fake = async (path, opts) => { if (path.endsWith('/csrf')) return response({ csrfToken: 'fixture-csrf' }); posted = opts; return response({ url: 'https://arena.example/api/auth/signin?error=CredentialsSignin' }); };
  await assert.rejects(performAuth('callback/credentials', { email: 'fixture@example.test', password: 'fixture-only-password' }, 'https://arena.example', fake), /not accepted/);
  assert.equal(posted.headers['X-Auth-Return-Redirect'], '1'); assert.equal(posted.body.get('csrfToken'), 'fixture-csrf'); assert.equal(posted.redirect, 'error');
  await assert.rejects(performAuth('callback/credentials', {}, 'https://arena.example', async path => path.endsWith('/csrf') ? response({ csrfToken: 'fixture' }) : new Response('<html>signin</html>')), /not completed/);
});

test('owner namespaced storage does not import legacy records and strips only legacy access key', () => {
  const records = new Map([['model-arena:v1', JSON.stringify({ accessKey: 'retired-fixture', corpus: 'existing unowned work' })]]);
  const storage = { getItem: k => records.get(k), setItem: (k,v) => records.set(k,v) };
  scrubLegacyAccessKey(storage); assert.deepEqual(JSON.parse(records.get('model-arena:v1')), { corpus: 'existing unowned work' });
  assert.notEqual(ownerStorageKey('A'), ownerStorageKey('B')); assert.equal(readWorkspace(storage, ownerStorageKey('A')), null);
});

test('prompt imports preserve aliases/references and reject duplicates or oversized sets', () => {
  const parsed = parsePromptFile(JSON.stringify([{ id:'x', question:'Who directed Inception?', expected:'Christopher Nolan' }, 'Why?']));
  assert.equal(parsed[0].reference,'Christopher Nolan'); assert.equal(parsed[0].id,'x'); assert.ok(parsed[1].id);
  assert.throws(() => parsePromptFile(JSON.stringify(Array(31).fill('test'))), /30/);
  assert.throws(() => parsePromptFile(JSON.stringify([{ id:'x',prompt:'a' },{id:'x',prompt:'b'}])), /unique/);
  assert.throws(() => parsePromptFile(JSON.stringify(['a'.repeat(8001)])), /8,000/);
});

test('saved blank drafts persist and interrupted jobs do not falsely resume', () => {
  const saved={ models:['fixture'],system:'',corpus:'',prompts:[{id:'draft',prompt:'',reference:''}],results:{x:{status:'running'}},grades:{} };
  const restored=readWorkspace({getItem:()=>JSON.stringify(saved)},'owned'); assert.equal(restored.prompts[0].prompt,''); assert.equal(restored.results.x.status,'error');
});

test('CSV neutralizes spreadsheet formulas while retaining quotes and multiline text', () => {
  assert.equal(csvEscape('=1+1'), "'=1+1"); assert.equal(csvEscape('  @SUM(A1)'), "'  @SUM(A1)");
  assert.equal(csvEscape('ordinary, "quote"'), '"ordinary, ""quote"""'); assert.equal(csvEscape('two\nlines'), '"two\nlines"');
});

test('editing one prompt invalidates only that row; reference/grader edits invalidate grades only', () => {
  const results = { 'q1|m': { text: 'answer1' }, 'q2|m': { text: 'answer2' } }; const grades = { q1: { best: 'm' }, q2: { best: 'm' } };
  const row = invalidateComparison(results, grades, { promptId: 'q1' });
  assert.deepEqual(Object.keys(row.results), ['q2|m']); assert.deepEqual(Object.keys(row.grades), ['q2']);
  const reference = invalidateComparison(results, grades, { promptId: 'q1', gradesOnly: true });
  assert.equal(reference.results, results); assert.deepEqual(Object.keys(reference.grades), ['q2']);
  assert.deepEqual(invalidateComparison(results, grades), { results: {}, grades: {} });
  assert.deepEqual(invalidateComparison(results, grades, { gradesOnly: true }), { results, grades: {} });
});

test('a delayed failed session refresh cannot invalidate a newer login', async () => {
  const pending = defer(); const client = createClientSession(() => pending.promise);
  client.accept(user('A')); const reading = client.read(); client.accept(user('B')); const b = client.capture();
  pending.resolve(response({}, 503)); await assert.rejects(reading, { name: 'AbortError' }); assert.equal(client.current(b), true);
});
