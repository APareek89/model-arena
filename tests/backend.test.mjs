import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { database, query, closeDatabase } from "../lib/db.js";
import { authSecret, csrfToken, validCsrf, requireCsrf, origin } from "../lib/security.js";
import { localPreview } from "../lib/runtime.js";
import { pricedHF, clearCatalogForTests } from "../lib/catalog.js";
import { generationInput, gradingInput, gradeRequest, parseGrade, generate, grade } from "../lib/providers.js";
import { EXAMPLE, preparedGeneration, preparedGrade } from "../lib/examples.js";
import { reserve, settle, uncertain, ownUsage, withCapacity } from "../lib/usage.js";
import { providerJson } from "../lib/provider-http.js";
import { readJson } from "../lib/http.js";

let a,b; const originalFetch=globalThis.fetch;
const noNetwork=async()=>{throw new Error("Tests forbid real network fetch");};
const priced={id:"Qwen/Qwen3-4B-Instruct-2507",upstream:"Qwen/Qwen3-4B-Instruct-2507:nscale",provider:"huggingface",inputPrice:.01,outputPrice:.03};
const hfEntry={id:priced.id,providers:[{provider:"nscale",status:"live",pricing:{input:.01,output:.03}},{provider:"unpriced",status:"live",pricing:{}}]};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});

test.before(async()=>{
  assert.ok(process.env.MODEL_ARENA_TEST_ENV,"Set MODEL_ARENA_TEST_ENV to the private isolated test environment file");
  const env=JSON.parse(await readFile(process.env.MODEL_ARENA_TEST_ENV,"utf8"));
  const url=new URL(env.DATABASE_URL);assert.equal(url.hostname,"127.0.0.1");assert.match(url.pathname,/_test$/);
  Object.assign(process.env,env,{NODE_ENV:"test",MODEL_ARENA_LOCAL_PREVIEW:"0"});
  delete process.env.HF_TOKEN;delete process.env.GEMINI_API_KEY;globalThis.fetch=noNetwork;
  await database();a={id:randomUUID()};b={id:randomUUID()};
  for(const actor of [a,b])await query("INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)",[actor.id,`${randomUUID()}@example.invalid`,"synthetic-test-row-no-login"]);
});
test.afterEach(()=>{globalThis.fetch=noNetwork;process.env.MODEL_ARENA_MOCK_MODE="1";delete process.env.HF_TOKEN;delete process.env.GEMINI_API_KEY;delete process.env.MODEL_ARENA_OWNER_BUDGET_USD;delete process.env.MODEL_ARENA_SHARED_BUDGET_USD;clearCatalogForTests();});
test.after(async()=>{globalThis.fetch=originalFetch;await closeDatabase();});

test("generation validates roles/text and retains bounded decoding",()=>{
  const value=generationInput({model:priced.id,messages:[{role:"system",content:"Reference: test"},{role:"user",content:"Question"}],max_tokens:9999,temperature:99});
  assert.equal(value.max_tokens,2048);assert.equal(value.temperature,2);assert.equal(value.messages[0].content,"Reference: test");
  for(const messages of [[{role:"assistant",content:"hidden"}],[{role:"user",content:{image_url:"http://invalid"}}],[{role:"user",content:"x".repeat(39001)}],[{role:"user",content:"one"},{role:"user",content:"two"}]])assert.throws(()=>generationInput({model:priced.id,messages}));
});
test("grading bounds and anonymous label mapping reject missing/duplicate/malformed scores",()=>{
  assert.throws(()=>gradingInput({prompt:"Q",responses:Array.from({length:4},(_,i)=>({model:String(i),text:"x"}))}));
  const shown=[{label:"A",model:"__proto__"},{label:"B",model:"normal"}];
  const score=label=>({label,accuracy:8,helpfulness:9,format:10,reason:"Fixture"});
  const parsed=parseGrade({scores:[score("B"),score("A")],best:"ANSWER A"},shown);
  assert.equal(Object.getPrototypeOf(parsed.scores),null);assert.equal(parsed.scores.__proto__.overall,9);assert.equal(parsed.best,"__proto__");
  for(const scores of [[score("A")],[score("A"),score("A")],[{...score("A"),accuracy:99},score("B")]])assert.throws(()=>parseGrade({scores,best:"A"},shown));
});
test("grading payload preserves corpus/reference and does not send model identifiers",()=>{
  const input=gradingInput({grader:"gemini-2.5-flash-lite",prompt:"Question",reference:"Reference",corpus:"Corpus",systemPrompt:"System",responses:[{model:"private-model-one",text:"First answer"},{model:"private-model-two",text:"Second answer"}]});
  const {shown,request}=gradeRequest(input);const body=JSON.stringify(request);
  assert.deepEqual(new Set(shown.map(v=>v.label)),new Set(["A","B"]));assert.match(body,/REFERENCE CORPUS/);assert.match(body,/REFERENCE ANSWER/);assert.doesNotMatch(body,/private-model/);assert.equal(request.generationConfig.maxOutputTokens,2048);assert.equal(request.generationConfig.thinkingConfig.thinkingBudget,0);
});
test("prepared fixtures ignore injected text/settings and never use a provider",async()=>{
  const body={example_id:EXAMPLE.id,prompt_id:"movie-director",model:EXAMPLE.settings.models[0],messages:[{role:"user",content:"Override"}],mode:"live",responses:[]};
  assert.equal(preparedGeneration(body).text,"Christopher Nolan");assert.equal(preparedGrade(body).provider,"prepared");assert.equal(preparedGrade(body).cached,true);
  assert.throws(()=>preparedGeneration({...body,model:"unknown"}));assert.throws(()=>preparedGeneration({...body,prompt_id:"unknown"}));
  const count=(await ownUsage(a)).requests;await Promise.all([Promise.resolve(preparedGeneration(body)),generate(b,{model:priced.id,messages:[{role:"user",content:"Inception"}]})]);assert.equal((await ownUsage(a)).requests,count);
});
test("only finite priced live provider routes are selected and pinned",()=>{
  assert.equal(pricedHF(hfEntry).upstream,priced.upstream);assert.equal(pricedHF(hfEntry,"unpriced"),null);
  assert.equal(pricedHF({id:"bad",providers:[{provider:"x",status:"live",pricing:{input:".01",output:.02}}]}),null);
  assert.equal(pricedHF({id:"bad",providers:[{provider:"x",status:"down",pricing:{input:.01,output:.02}}]}),null);
});
test("real PG default budgets reserve and settle with strict owner scope",async()=>{
  const id=await reserve(a,"generate",priced,{messages:[{content:"fixture"}]},64);
  const before=(await query("SELECT * FROM usage WHERE id=$1 AND owner_id=$2",[id,a.id])).rows[0];assert.equal(before.status,"reserved");
  await settle(b,id,{input:100,output:10});await uncertain(b,id);
  assert.equal((await query("SELECT status FROM usage WHERE id=$1 AND owner_id=$2",[id,a.id])).rows[0].status,"reserved");
  await settle(a,id,{input:100,output:10,cached:20,reasoning:3});
  const after=(await query("SELECT actual_usd::text,status,cached_input_tokens,reasoning_output_tokens FROM usage WHERE id=$1 AND owner_id=$2",[id,a.id])).rows[0];
  assert.equal(Number(after.actual_usd),.0000013);assert.equal(after.status,"complete");assert.equal(after.cached_input_tokens,20);assert.equal(after.reasoning_output_tokens,3);
});
test("owner/global cap and unknown price rejects leave ledger unchanged",async()=>{
  const before=(await query("SELECT count(*)::int AS count FROM usage")).rows[0].count;
  process.env.MODEL_ARENA_OWNER_BUDGET_USD="0";await assert.rejects(reserve(a,"generate",priced,{},64),/budget/);
  delete process.env.MODEL_ARENA_OWNER_BUDGET_USD;process.env.MODEL_ARENA_SHARED_BUDGET_USD="0";await assert.rejects(reserve(b,"generate",priced,{},64),/budget/);
  await assert.rejects(reserve(b,"generate",{...priced,inputPrice:NaN},{},64),/price/);
  assert.equal((await query("SELECT count(*)::int AS count FROM usage")).rows[0].count,before);
});
test("capacity bounds concurrent same-owner calls without sharing identity",async()=>{
  let unblock;const gate=new Promise(resolve=>{unblock=resolve;});const running=Array.from({length:3},()=>withCapacity(a,()=>gate));
  await assert.rejects(withCapacity(a,async()=>{}),/capacity/);assert.equal(await withCapacity(b,async()=>"B"),"B");unblock();await Promise.all(running);assert.equal(await withCapacity(a,async()=>"A"),"A");
});
test("CSRF reuses same-session token and rejects another identity or origin",()=>{
  const token=csrfToken(null,`session:${a.id}`);assert.equal(csrfToken(token,`session:${a.id}`),token);assert.equal(validCsrf(token,`session:${b.id}`),false);assert.equal(validCsrf(token+"é",`session:${a.id}`),false);
  const req=new Request(origin()+"/api/generate",{method:"POST",headers:{origin:origin(),"x-csrf-token":token}});assert.doesNotThrow(()=>requireCsrf(req,{sid:a.id}));
  assert.throws(()=>requireCsrf(new Request(origin()+"/api/generate",{method:"POST",headers:{origin:"https://untrusted.invalid","x-csrf-token":token}}),{sid:a.id}));
});
test("production loopback preview rejects public origins, remote DB and provider keys",()=>{
  const prior={...process.env};Object.assign(process.env,{NODE_ENV:"production",MODEL_ARENA_LOCAL_PREVIEW:"1"});assert.equal(localPreview(),true);
  process.env.PUBLIC_ORIGIN="https://public.example";assert.throws(localPreview);process.env.PUBLIC_ORIGIN=prior.PUBLIC_ORIGIN;
  const old=process.env.DATABASE_URL;process.env.DATABASE_URL="postgresql://db.invalid/test";assert.throws(localPreview);process.env.DATABASE_URL=old;
  process.env.HF_TOKEN="unit";assert.throws(localPreview);delete process.env.HF_TOKEN;Object.assign(process.env,{NODE_ENV:prior.NODE_ENV,MODEL_ARENA_LOCAL_PREVIEW:prior.MODEL_ARENA_LOCAL_PREVIEW});
});
test("provider wire uses one pinned request and successful usage persists before content validation",async()=>{
  process.env.MODEL_ARENA_MOCK_MODE="0";process.env.HF_TOKEN="unit";let calls=0;
  globalThis.fetch=async(url,init)=>{
    if(url.endsWith("/v1/models"))return response({data:[hfEntry]});
    assert.equal(url,"https://router.huggingface.co/v1/chat/completions");calls++;const body=JSON.parse(init.body);assert.equal(body.model,priced.upstream);assert.equal(body.max_tokens,64);assert.equal(init.redirect,"error");
    return response({model:priced.id,choices:[],usage:{prompt_tokens:100,completion_tokens:10}});
  };
  await assert.rejects(generate(a,{model:priced.id,messages:[{role:"user",content:"fixture"}],max_tokens:64}),/readable text/);
  assert.equal(calls,1);const row=(await query("SELECT status,input_tokens FROM usage WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 1",[a.id])).rows[0];assert.equal(row.status,"complete");assert.equal(row.input_tokens,100);
});
test("provider 429 has no automatic retry and retains conservative reservation",async()=>{
  process.env.MODEL_ARENA_MOCK_MODE="0";process.env.HF_TOKEN="unit";let calls=0;
  globalThis.fetch=async url=>{if(url.endsWith("/v1/models"))return response({data:[hfEntry]});calls++;return response({error:"Do not expose this provider body"},429);};
  await assert.rejects(generate(a,{model:priced.id,messages:[{role:"user",content:"fixture"}],max_tokens:64}),error=>error.status===502&&!error.message.includes("expose"));assert.equal(calls,1);
  assert.equal((await query("SELECT status FROM usage WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 1",[a.id])).rows[0].status,"uncertain");
});
test("Gemini malformed grade keeps known billed usage and bounded anonymous request",async()=>{
  process.env.MODEL_ARENA_MOCK_MODE="0";process.env.GEMINI_API_KEY="unit";let calls=0;
  globalThis.fetch=async(url,init)=>{
    assert.ok(!String(url).includes("key="));
    if(String(url).includes("?pageSize="))return response({models:[{name:"models/gemini-2.5-flash-lite",supportedGenerationMethods:["generateContent"]}]});
    calls++;const body=JSON.parse(init.body);assert.equal(body.generationConfig.maxOutputTokens,2048);assert.equal(body.generationConfig.thinkingConfig.thinkingBudget,0);assert.ok(!JSON.stringify(body).includes("private-model"));return response({candidates:[{content:{parts:[{text:"invalid JSON"}]}}],usageMetadata:{promptTokenCount:120,candidatesTokenCount:20,thoughtsTokenCount:5}});
  };
  await assert.rejects(grade(a,{prompt:"Question",responses:[{model:"private-model",text:"Answer"}]}),/unreadable scores/);assert.equal(calls,1);
  const row=(await query("SELECT status,input_tokens,output_tokens,reasoning_output_tokens FROM usage WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 1",[a.id])).rows[0];assert.equal(row.status,"complete");assert.equal(row.output_tokens,25);assert.equal(row.reasoning_output_tokens,5);
});
test("bounded JSON bodies and decoded provider responses reject expansion",async()=>{
  await assert.rejects(readJson(new Request("http://localhost/",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({value:"x".repeat(100)})}),32),/large/);
  globalThis.fetch=async()=>new Response("x".repeat(64));await assert.rejects(providerJson("https://fixture.invalid/",{},{maximum:32}),/size limit/);
});
test("missing or short authentication configuration fails closed without import-time secrets",()=>{
  const previous=process.env.AUTH_SECRET;
  try { delete process.env.AUTH_SECRET;assert.throws(authSecret,/session secret/);process.env.AUTH_SECRET="short";assert.throws(authSecret,/session secret/); }
  finally {process.env.AUTH_SECRET=previous;}
  assert.equal(typeof authSecret(),"string");
});
test("failed database identity initialization releases its connection and a corrected retry works",async()=>{
  const program=`import {database,closeDatabase} from './lib/db.js';
    const expected=process.env.DATABASE_NAME;process.env.DATABASE_NAME='deliberately_wrong_database';
    let rejected=false;try{await database();}catch{rejected=true;}
    if(!rejected)throw Error('Identity mismatch was accepted');
    process.env.DATABASE_NAME=expected;await database();await closeDatabase();`;
  try { await promisify(execFile)(process.execPath,["--input-type=module","-e",program],{cwd:process.cwd(),env:process.env,timeout:5000,maxBuffer:1024}); }
  catch { assert.fail("Failed database initialization did not close and recover within five seconds"); }
});
