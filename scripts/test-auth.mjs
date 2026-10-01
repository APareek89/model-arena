// Meaningful HTTP tests against a separately running, network-denied local build.
// Never use this harness with a deployed database or public application.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { query, closeDatabase } from '../lib/db.js';

const env = JSON.parse(await readFile(process.env.MODEL_ARENA_TEST_ENV, 'utf8'));
const base = new URL(env.PUBLIC_ORIGIN), db = new URL(env.DATABASE_URL);
assert.equal(base.hostname, '127.0.0.1'); assert.equal(base.port, '8962');
assert.equal(db.hostname, '127.0.0.1'); assert.match(db.pathname, /_test$/);
assert.equal(env.MODEL_ARENA_MOCK_MODE, '1'); assert.ok(!env.HF_TOKEN && !env.GEMINI_API_KEY);
Object.assign(process.env, env, {NODE_ENV:'test',MODEL_ARENA_LOCAL_PREVIEW:'0'});
const checks = [];
const peer = `127.23.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
class Client {
  constructor(){this.jar=new Map();this.csrf=null;this.user=null;}
  async request(path,{method='GET',body,headers={}}={}){
    const result=await fetch(new URL(path,base),{method,redirect:'manual',signal:AbortSignal.timeout(15000),headers:{cookie:[...this.jar].map(([k,v])=>`${k}=${v}`).join('; '),'x-forwarded-for':peer,...(method==='POST'?{origin:base.origin}:{}),...headers},...(body===undefined?{}:{body})});
    const set=result.headers.getSetCookie();for(const value of set){const pair=value.split(';')[0],i=pair.indexOf('=');this.jar.set(pair.slice(0,i),pair.slice(i+1));}
    const raw=await result.text();let data;try{data=JSON.parse(raw);}catch{data=null;}
    return {status:result.status,data,cookies:set,headers:result.headers};
  }
  json(path,body,headers={}){return this.request(path,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':this.csrf||'',...headers},body:JSON.stringify(body)});}
  async session(){const r=await this.request('/api/session');assert.equal(r.status,200,'Session must return JSON200');assert.equal(r.data.enabled,true);this.csrf=r.data.csrf_token;this.user=r.data.user;return r;}
  async auth(action,credential={}){
    const token=await this.request('/api/auth/csrf');assert.equal(token.status,200);assert.ok(token.data.csrfToken);
    const form=new URLSearchParams({...credential,csrfToken:token.data.csrfToken,json:'true',callbackUrl:base.origin});
    const result=await this.request(`/api/auth/${action}`,{method:'POST',body:form.toString(),headers:{'content-type':'application/x-www-form-urlencoded','X-Auth-Return-Redirect':'1'}});
    assert.equal(result.status,200,'Actual Auth.js callback must return JSON200, not HTML/redirect/error');assert.equal(typeof result.data?.url,'string');
    return result;
  }
}
function pass(name){checks.push(name);}
try {
  const health=await new Client().request('/api/healthz');assert.equal(health.status,200);assert.deepEqual(health.data,{ok:true,auth:true,mock:true});pass('production-built authenticated mock health');
  const anonymous=new Client();await anonymous.session();assert.equal(anonymous.user,null);
  for(const path of ['/api/config','/api/example','/api/models','/api/grader-models'])assert.equal((await anonymous.request(path)).status,401);
  assert.equal((await anonymous.json('/api/generate',{})).status,401);
  anonymous.jar.set('arena-session','invalid-encrypted-session');assert.equal((await anonymous.request('/api/config')).status,401);anonymous.jar.delete('arena-session');
  assert.equal((await anonymous.request('/api/config',{headers:{authorization:'Bearer invalid-token'}})).status,401);pass('anonymous and malformed token fail closed');
  const a=new Client(),b=new Client();const credentials=[];
  for(const client of [a,b]){
    await client.session();const credential={email:`arena-${randomUUID()}@example.invalid`,password:randomBytes(24).toString('base64url')};credentials.push(credential);
    assert.equal((await client.json('/api/auth/signup',credential,{'x-csrf-token':'invalid'})).status,403);
    assert.equal((await client.json('/api/auth/signup',credential,{origin:'https://untrusted.invalid'})).status,403);
    assert.equal((await client.json('/api/auth/signup',credential)).status,201);
    assert.equal((await client.json('/api/auth/signup',credential)).status,409);
  }
  pass('two normal signups with exact-origin CSRF and duplicate rejection');
  const bad=await a.auth('callback/credentials',{...credentials[0],password:'Wrong-password-12345'});assert.match(new URL(bad.data.url).searchParams.get('error')||'',/CredentialsSignin/);await a.session();assert.equal(a.user,null);pass('bad password actual Auth.js JSON error contract');
  for(const [i,client] of [a,b].entries()){
    const logged=await client.auth('callback/credentials',credentials[i]);assert.ok(!new URL(logged.data.url).searchParams.has('error'));
    assert.ok(logged.cookies.some(v=>v.startsWith('arena-session=')&&/HttpOnly/i.test(v)&&/SameSite=Lax/i.test(v)));
    await client.session();assert.match(client.user.id,/^[a-f0-9-]{36}$/);assert.equal(client.user.email,credentials[i].email);
  }
  assert.notEqual(a.user.id,b.user.id);pass('real credentials callbacks create distinct durable sessions');
  const aId=a.user.id,bId=b.user.id;
  const hashes=await query('SELECT id,password_hash FROM users WHERE id=ANY($1::uuid[])',[[aId,bId]]);assert.equal(hashes.rows.length,2);assert.ok(hashes.rows.every(row=>/^\$2[aby]\$12\$/.test(row.password_hash)));pass('bcrypt12 hashes persisted for normal signup');
  const token=a.csrf;await a.session();assert.equal(a.csrf,token);await a.session();assert.equal(a.csrf,token);
  const example=(await a.request('/api/example')).data;
  const payload={example_id:example.id,prompt_id:example.prompts[0].id,model:example.settings.models[0],messages:[{role:'user',content:'ignored untrusted override'}],mode:'live'};
  assert.equal((await b.json('/api/generate',payload,{'x-csrf-token':token})).status,403);assert.equal((await a.json('/api/generate',payload,{origin:'https://untrusted.invalid'})).status,403);
  pass('repeated session reads reuse CSRF; cross-session and origin replay denied');
  const prior=(await query('SELECT count(*)::int AS n FROM usage')).rows[0].n;
  for(const prompt of example.prompts){
    const answers=await Promise.all(example.settings.models.map(model=>a.json('/api/generate',{...payload,prompt_id:prompt.id,model})));for(const answer of answers){assert.equal(answer.status,200);assert.equal(answer.data.provider,'prepared');assert.equal(answer.data.cached,true);assert.ok(answer.data.text);}
    const grade=await a.json('/api/grade',{example_id:example.id,prompt_id:prompt.id,prompt:'ignored',responses:[],grader:'unknown'});assert.equal(grade.status,200);assert.equal(grade.data.provider,'prepared');assert.equal(Object.keys(grade.data.scores).length,2);
  }
  const normal=await b.json('/api/generate',{model:example.settings.models[0],messages:[{role:'user',content:'Inception'}]});assert.equal(normal.status,200);assert.equal(normal.data.provider,'mock');assert.equal(normal.data.cached,false);
  assert.equal((await query('SELECT count(*)::int AS n FROM usage')).rows[0].n,prior);pass('six prepared answers, three grades, concurrent owner mock leave paid ledger unchanged');
  assert.equal((await a.json('/api/generate',{...payload,prompt_id:'invented'})).status,400);
  assert.equal((await a.json('/api/generate',{...payload,model:'invented'})).status,400);pass('canonical example identifiers reject forged fixture selectors');
  const config=await a.request('/api/config');assert.equal(config.status,200);assert.equal(config.data.providerMode,'mock');assert.equal(config.data.defaultGrader,'gemini-2.5-flash-lite');
  assert.equal((await a.request('/api/models')).status,200);assert.equal((await a.request('/api/grader-models')).status,200);pass('authenticated catalogs and default configuration');
  const copied=new Client();copied.jar=new Map(a.jar);copied.csrf=a.csrf;
  const out=await a.auth('signout');assert.equal(new URL(out.data.url).origin,base.origin);await a.session();assert.equal(a.user,null);
  assert.equal((await copied.request('/api/config')).status,401);assert.equal((await copied.json('/api/generate',payload)).status,401);
  assert.equal((await b.request('/api/config')).status,200);pass('signout revokes copied JWT immediately without revoking another owner');
  await a.auth('callback/credentials',credentials[0]);await a.session();assert.equal(a.user.id,aId);assert.equal((await a.json('/api/generate',payload,{'x-csrf-token':token})).status,403);pass('new login rejects prior session CSRF');
  await query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE owner_id=$1 AND revoked_at IS NULL",[aId]);assert.equal((await a.request('/api/config')).status,401);pass('database expiry rechecked on each request');
  await query('UPDATE users SET disabled=true WHERE id=$1',[bId]);assert.equal((await b.request('/api/config')).status,401);await query('UPDATE users SET disabled=false WHERE id=$1',[bId]);assert.equal((await b.request('/api/config')).status,200);pass('database account revocation rechecked without changing other accounts');
  const badOrigin=await b.request('/api/auth/signout',{method:'POST',headers:{origin:'https://untrusted.invalid','content-type':'application/x-www-form-urlencoded'},body:'csrfToken=invalid'});assert.equal(badOrigin.status,403);
  const tooLarge=await b.request('/api/auth/callback/credentials',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'a'.repeat(8193)});assert.equal(tooLarge.status,413);pass('Auth.js form boundary keeps origin and body limits');
  await b.auth('signout');
  const result={status:'passed',checks:checks.length,assertions:checks,provider_dispatches:0,prepared_answers:6,prepared_grades:3,base:base.origin};
  if(process.env.MODEL_ARENA_HTTP_RECEIPT)await writeFile(process.env.MODEL_ARENA_HTTP_RECEIPT,JSON.stringify(result,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(result));
} finally { await closeDatabase(); }
