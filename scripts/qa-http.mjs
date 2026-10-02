// Normal HTTP auth/routes; run only against qa-server.mjs with its deny-network guard.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const origin=process.env.MODEL_ARENA_QA_ORIGIN||'http://127.0.0.1:8995';
const url=new URL(origin);if(url.hostname!=='127.0.0.1'||url.protocol!=='http:'||url.origin!==origin)throw Error('Only explicit loopback origin accepted');
const jar=new Map();const checks=[];
async function request(path,{method='GET',body,headers={},anonymous=false}={}){
 const r=await fetch(origin+path,{method,redirect:'error',headers:{...(anonymous?{}:{cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')}),...(method==='POST'?{origin}:{}),...headers},body});
 if(!anonymous)for(const raw of r.headers.getSetCookie()){const [pair]=raw.split(';');const i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}
 let data;try{data=await r.json();}catch{data=null;}return{status:r.status,data,headers:r.headers};
}
function check(name,action){return Promise.resolve().then(action).then(()=>checks.push({name,status:'passed',method:'actual-local-http; offline-provider-fixture'}));}
let session=(await request('/api/session')).data;
const csrf=()=>({'content-type':'application/json','x-csrf-token':session.csrf_token});
const email=`arena-fmea-${randomUUID()}@example.invalid`,password=`local-only-${randomUUID()}`;
await check('normal signup',async()=>assert.equal((await request('/api/auth/signup',{method:'POST',headers:csrf(),body:JSON.stringify({email,password})})).status,201));
const token=(await request('/api/auth/csrf')).data.csrfToken;
await check('normal sign in',async()=>{const r=await request('/api/auth/callback/credentials',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-auth-return-redirect':'1'},body:new URLSearchParams({csrfToken:token,email,password,callbackUrl:origin,json:'true'}).toString()});assert.equal(r.status,200);assert.ok(!new URL(r.data.url).searchParams.has('error'));});
session=(await request('/api/session')).data;assert.ok(session.user?.id);
const post=body=>request('/api/grade',{method:'POST',headers:csrf(),body:JSON.stringify(body)});
const defaults={graderProvider:'gemini',grader:'gemini-2.5-flash-lite',graderKey:'offline-fixture-key-only',prompt:'Q',responses:[{model:'m',text:'answer'}]};
await check('config uses user-key mode',async()=>{const r=await request('/api/config');assert.equal(r.status,200);assert.equal(r.data.graderMode,'user_key');assert.equal(r.data.needsKey,true);});
await check('public preset catalog has three providers without provider dispatch',async()=>{const r=await request('/api/grader-models');assert.equal(r.status,200);assert.deepEqual(r.data.providers.map(p=>p.id),['gemini','openai','claude']);});
await check('unauthenticated grade rejected',async()=>assert.equal((await request('/api/grade',{method:'POST',anonymous:true,headers:{'content-type':'application/json'},body:JSON.stringify(defaults)})).status,401));
await check('wrong CSRF rejected before grading',async()=>assert.equal((await request('/api/grade',{method:'POST',headers:{...csrf(),'x-csrf-token':'wrong'},body:JSON.stringify(defaults)})).status,403));
await check('wrong Origin rejected before grading',async()=>assert.equal((await request('/api/grade',{method:'POST',headers:{...csrf(),origin:'https://foreign.invalid'},body:JSON.stringify(defaults)})).status,403));
await check('missing key is actionable400',async()=>{const r=await post({...defaults,graderKey:''});assert.equal(r.status,400);assert.match(r.data.error,/Configure/);});
await check('malformed request JSON rejected',async()=>assert.equal((await request('/api/grade',{method:'POST',headers:csrf(),body:'{bad'})).status,400));
const cases=JSON.parse(readFileSync(new URL('../tests/fixtures/session-proxy.json',import.meta.url))).cases;
for(const [provider,model] of [['gemini','gemini-2.5-flash-lite'],['openai','gpt-4.1-mini'],['claude','claude-haiku-4-5']])for(const fixture of cases)await check(`${provider} HTTP session-proxy ${fixture.id}`,async()=>{
 const r=await post({...defaults,...fixture,graderProvider:provider,grader:model});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.provider,provider);assert.equal(r.data.billing.costUSD,null);assert.equal(r.data.billing.source,'user_key');
 for(const source of fixture.responses)assert.equal(r.data.scores[source.model].accuracy,source.proxy_score.accuracy);assert.ok(!JSON.stringify(r.data).includes(defaults.graderKey));
});
await check('provider401 becomes502 with safe actionable error',async()=>{const r=await post({...defaults,prompt:'__FIXTURE_GRADE_401__'});assert.equal(r.status,502);assert.match(r.data.error,/HTTP 401/);assert.match(r.data.error,/Configure/);assert.match(r.data.requestId,/^[0-9a-f-]{36}$/);});
await check('malformed provider JSON becomes502',async()=>{const r=await post({...defaults,prompt:'__FIXTURE_BAD_JSON__'});assert.equal(r.status,502);assert.match(r.data.error,/unreadable scores/);});
await check('actual generation route retains truncation marker',async()=>{const r=await request('/api/generate',{method:'POST',headers:csrf(),body:JSON.stringify({model:'Qwen/Qwen3-4B-Instruct-2507',messages:[{role:'user',content:'__FIXTURE_TRUNCATE__'}],max_tokens:32})});assert.equal(r.status,200);assert.equal(r.data.finish,'length');});
const example=(await request('/api/example')).data;
await check('prepared example grades without key through actual route',async()=>{const r=await post({example_id:example.id,prompt_id:example.prompts[0].id});assert.equal(r.status,200);assert.equal(r.data.provider,'prepared');});
const out={at:new Date().toISOString(),origin,providerCalls:0,mode:'local HTTP with normal signup/session/CSRF and external-network-denying transport',checks,passed:checks.length};
if(process.env.MODEL_ARENA_QA_RECEIPT)writeFileSync(process.env.MODEL_ARENA_QA_RECEIPT,JSON.stringify(out,null,2));
const signoutToken=(await request('/api/auth/csrf')).data.csrfToken;
await request('/api/auth/signout',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-auth-return-redirect':'1'},body:new URLSearchParams({csrfToken:signoutToken,callbackUrl:origin,json:'true'}).toString()});
console.log(JSON.stringify({passed:checks.length,providerCalls:0,mode:out.mode}));
