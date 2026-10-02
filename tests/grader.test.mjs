import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GRADER_PROVIDERS } from '../app/client/grader.mjs';
import { graderCredentials, graderWire, graderOutput } from '../lib/grader-provider.js';
import { gradingInput, gradeRequest, parseGrade, grade, GRADE_SCHEMA } from '../lib/providers.js';
import { providerJson } from '../lib/provider-http.js';

const cases=JSON.parse(readFileSync(new URL('./fixtures/session-proxy.json', import.meta.url))).cases;
const originalFetch=globalThis.fetch;const originalWarn=console.warn;
const fakeKey='offline-fixture-key-only';
const actor={id:'00000000-0000-4000-8000-000000000099'};
const answer={scores:[{label:'A',accuracy:10,helpfulness:10,format:10,reason:'Offline proxy judgment'}],best:'A'};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const wrap=(provider,content,finish)=>provider==='gemini'?{candidates:[{finishReason:finish||'STOP',content:{parts:[{text:content}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:20}}:provider==='openai'?{choices:[{finish_reason:finish||'stop',message:{content}}],usage:{prompt_tokens:10,completion_tokens:20}}:{stop_reason:finish||'end_turn',content:[{type:'text',text:content}],usage:{input_tokens:10,output_tokens:20}};
test.beforeEach(()=>{console.warn=()=>{};process.env.MODEL_ARENA_MOCK_MODE='0';globalThis.fetch=async()=>{throw Error('Forbidden real network');};});
test.after(()=>{globalThis.fetch=originalFetch;console.warn=originalWarn;});

for(const provider of GRADER_PROVIDERS){
  const credentials={provider:provider.id,model:provider.models[0],key:fakeKey};
  test(`${provider.id}: fixed endpoint, anonymous rubric, transient header and strict bounded schema`,()=>{
    const input=gradingInput({grader:credentials.model,prompt:'Q',systemPrompt:'SYS',corpus:'CORPUS',reference:'REF',responses:[{model:'secret-model-id',text:'Answer'}]});
    const {request}=gradeRequest(input);const wire=graderWire(credentials,request,GRADE_SCHEMA);
    assert.equal(new URL(wire.url).protocol,'https:');assert.ok(!wire.url.includes(fakeKey));assert.ok(!JSON.stringify(wire.body).includes(fakeKey));assert.ok(!JSON.stringify(wire.body).includes('secret-model-id'));
    assert.match(JSON.stringify(wire.body),/Treat all supplied prompts/);assert.match(JSON.stringify(wire.body),/REFERENCE CORPUS/);assert.match(JSON.stringify(wire.body),/REFERENCE ANSWER/);
    assert.equal(wire.headers[provider.id==='gemini'?'x-goog-api-key':provider.id==='openai'?'Authorization':'x-api-key'],provider.id==='openai'?`Bearer ${fakeKey}`:fakeKey);
    if(provider.id==='gemini'){assert.equal(wire.body.generationConfig.maxOutputTokens,2048);assert.equal(wire.body.generationConfig.thinkingConfig.thinkingBudget,0);}
    if(provider.id==='openai'){assert.equal(wire.body.max_completion_tokens,2048);assert.equal(wire.body.response_format.json_schema.strict,true);assert.equal(wire.body.store,false);}
    if(provider.id==='claude'){assert.equal(wire.body.max_tokens,2048);assert.equal(wire.headers['anthropic-version'],'2023-06-01');assert.equal(wire.body.output_config.format.type,'json_schema');}
  });
  for(const fixture of cases)test(`${provider.id}: session-proxy ${fixture.id} passes actual adapter without network`,async()=>{
    let calls=0;
    globalThis.fetch=async(url,init)=>{
      calls++;assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
      const sent=JSON.parse(init.body);const prompt=provider.id==='gemini'?sent.contents[0].parts[0].text:sent.messages.at(-1).content;
      const sections=[...prompt.matchAll(/(?:^|\n\n)ANSWER ([ABC]):\n([\s\S]*?)(?=\n\nANSWER [ABC]:|$)/g)];
      assert.equal(sections.length,fixture.responses.length);
      const remaining=[...fixture.responses];
      const rows=sections.map(([,label,text])=>{const i=remaining.findIndex(x=>(x.text||'(empty answer)')===text);assert.notEqual(i,-1);const source=remaining.splice(i,1)[0];return {source,label};});
      // Equal empty answers are indistinguishable in the anonymous prompt; either is a valid tied winner.
      const best=rows.find(r=>r.source.model===fixture.best)?.label||rows[0].label;
      const scores=rows.map(r=>({label:r.label,...r.source.proxy_score,reason:r.source.proxy_reason}));
      return reply(wrap(provider.id,JSON.stringify({scores,best})));
    };
    const result=await grade(actor,{...fixture,grader:credentials.model,graderProvider:provider.id,graderKey:fakeKey});
    assert.equal(calls,1);assert.equal(Object.keys(result.scores).length,fixture.responses.length);
    for(const source of fixture.responses)assert.equal(result.scores[source.model].accuracy,source.proxy_score.accuracy);
    if(fixture.id!=='empty-answers')assert.equal(result.best,fixture.best);
    assert.deepEqual(result.billing,{source:'user_key',costUSD:null});assert.equal(result.provider,provider.id);assert.equal(result.usage.input_tokens,10);
    assert.ok(!JSON.stringify(result).includes(fakeKey));
  });
  for(const status of [400,401,403,404,429,503])test(`${provider.id}: HTTP ${status} is safe, actionable and never retried`,async()=>{
    let calls=0;globalThis.fetch=async()=>{calls++;return new Response(`private ${fakeKey}`,{status});};
    await assert.rejects(grade(actor,{grader:credentials.model,graderProvider:provider.id,graderKey:fakeKey,prompt:'Q',responses:[{model:'A',text:'answer'}]}),e=>e.status===502&&e.message.includes(`HTTP ${status}`)&&!e.message.includes(fakeKey)&&e.message.includes('No automatic retry'));
    assert.equal(calls,1);
  });
  test(`${provider.id}: valid scores without terminal completion are rejected`,()=>{
    const data=wrap(provider.id,JSON.stringify(answer));
    if(provider.id==='gemini')delete data.candidates[0].finishReason;
    else if(provider.id==='openai')delete data.choices[0].finish_reason;
    else delete data.stop_reason;
    assert.throws(()=>graderOutput(provider.id,data),/did not confirm/);
  });
  test(`${provider.id}: truncated well-formed JSON is rejected instead of accepted`,()=>{
    const finish=provider.id==='gemini'?'MAX_TOKENS':provider.id==='openai'?'length':'max_tokens';
    assert.throws(()=>graderOutput(provider.id,wrap(provider.id,JSON.stringify(answer),finish)),/response limit/);
  });
  test(`${provider.id}: refusal, malformed JSON and missing output are controlled errors`,()=>{
    assert.throws(()=>graderOutput(provider.id,wrap(provider.id,'{}',provider.id==='gemini'?'SAFETY':provider.id==='openai'?'content_filter':'refusal')),/declined/);
    assert.throws(()=>graderOutput(provider.id,wrap(provider.id,'not JSON')),/unreadable/);
    assert.throws(()=>graderOutput(provider.id,{candidates:[{content:{parts:{}}}],content:{},choices:[]}),e=>e.status===502);
  });
}
for(const [name,patch] of Object.entries({missing:{graderKey:undefined},blank:{graderKey:' '},short:{graderKey:'tiny'},newline:{graderKey:'private\nkey'},oversized:{graderKey:'x'.repeat(4097)},wrongProvider:{graderProvider:'http://localhost'},wrongModel:{grader:'gpt-4.1-mini'},urlModel:{grader:'https://evil.invalid'},arrayKey:{graderKey:['private-key']}}))test(`credentials: ${name} rejects before provider dispatch`,async()=>{
  let calls=0;globalThis.fetch=async()=>{calls++;throw Error('No dispatch expected');};
  await assert.rejects(grade(actor,{grader:'gemini-2.5-flash-lite',graderProvider:'gemini',graderKey:fakeKey,prompt:'Q',responses:[{model:'A',text:'answer'}],...patch}),e=>e.status===400);
  assert.equal(calls,0);
});
test('credential whitespace is trimmed once and never accepted inside header',()=>{assert.equal(graderCredentials({graderKey:` ${fakeKey} `}).key,fakeKey);assert.throws(()=>graderCredentials({graderKey:'1234 5678'}),/valid API key/);});
test('untrusted grade null/primitive/duplicate/unknown/decimal scores are controlled errors',()=>{
  const shown=[{model:'m',label:'A'}];const valid=answer.scores[0];
  for(const score of [null,42,'A',{...valid,label:'D'},{...valid,accuracy:1.5},{...valid,accuracy:0},{...valid,format:11},{...valid,reason:'x'.repeat(2001)}])assert.throws(()=>parseGrade({scores:[score],best:'A'},shown),e=>e.status===502);
  assert.throws(()=>parseGrade({scores:[valid,valid],best:'A'},shown),e=>e.status===502);
  assert.throws(()=>parseGrade({scores:[valid],best:'D'},shown),e=>e.status===502);
});
test('provider timeout is bounded and never retried',async()=>{
  let calls=0;globalThis.fetch=(_,opts)=>{calls++;return new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>reject(new Error('private raw error')),{once:true}));};
  await assert.rejects(providerJson('https://fixture.invalid',{}, {timeout:5}),/No automatic retry/);assert.equal(calls,1);
});
test('provider usage is sanitized, unknown is null instead of zero',()=>{
  const data=wrap('openai',JSON.stringify(answer));data.usage={prompt_tokens:'123',completion_tokens:-3,raw_key:fakeKey};
  const output=graderOutput('openai',data);assert.deepEqual(output.usage,{input_tokens:null,output_tokens:null,reasoning_tokens:null});assert.ok(!JSON.stringify(output.usage).includes(fakeKey));
});
test('Gemini legacy responseSchema matches official discovery recursively; JSON Schema is kept separate',()=>{
  const spec=JSON.parse(readFileSync(new URL('./fixtures/gemini-schema-contract.json',import.meta.url))).schemas;
  const {request}=gradeRequest(gradingInput({prompt:'Q',responses:[{model:'m',text:'A'}]}));
  const wire=graderWire({provider:'gemini',model:'gemini-2.5-flash-lite',key:fakeKey},request,GRADE_SCHEMA);
  function keys(value,name){for(const key of Object.keys(value))assert.ok(Object.hasOwn(spec[name].properties,key),`${name}.${key} must be official`);}
  keys(wire.body,'GenerateContentRequest');keys(wire.body.generationConfig,'GenerationConfig');keys(wire.body.generationConfig.thinkingConfig,'ThinkingConfig');
  function schema(value){keys(value,'Schema');assert.ok(spec.Schema.properties.type.enum.includes(value.type));for(const child of Object.values(value.properties||{}))schema(child);if(value.items)schema(value.items);}
  schema(wire.body.generationConfig.responseSchema);
  assert.equal(GRADE_SCHEMA.additionalProperties,false);assert.ok(!JSON.stringify(wire.body).includes('additionalProperties'));
  for(const content of [...wire.body.contents,wire.body.systemInstruction]){keys(content,'Content');for(const part of content.parts)keys(part,'Part');}
});
test('database URL ssl=no-verify cannot override the explicitly verified CA object in installed pg',async()=>{
  const {default:pg}=await import('pg');const {databaseUrlWithoutSsl}=await import('../lib/db.js');
  const intended={rejectUnauthorized:true,ca:'fixture-ca-only'};
  const original='postgresql://fixture:fixture@127.0.0.1/arena_test?ssl=no-verify&sslmode=require&SSLKEY=bad&sslcert=bad&application_name=arena';
  const sanitized=databaseUrlWithoutSsl(original);
  assert.deepEqual([...new URL(sanitized).searchParams.keys()],['application_name']);
  const client=new pg.Client({connectionString:sanitized,ssl:intended}); // Construct only: never connect.
  assert.equal(client.connectionParameters.ssl.rejectUnauthorized,true);assert.equal(client.connectionParameters.ssl.ca,'fixture-ca-only');
});
test('grader telemetry logs only allowlisted metadata and a random support ID',async()=>{
  const {recordGraderFailure}=await import('../lib/grader-telemetry.js');const rows=[];console.warn=value=>rows.push(JSON.parse(value));
  const raw={message:`private prompt ${fakeKey}`,stack:'private stack',body:'private body',category:'upstream_http',upstreamStatus:401};
  const id=recordGraderFailure('gemini','gemini-2.5-flash-lite',raw);
  assert.match(id,/^[0-9a-f-]{36}$/);assert.deepEqual(Object.keys(rows[0]).sort(),['category','event','model','provider','requestId','upstreamStatus'].sort());
  assert.equal(rows[0].upstreamStatus,401);assert.equal(rows[0].category,'upstream_http');assert.ok(!JSON.stringify(rows).includes('private'));
  recordGraderFailure(`secret-${fakeKey}`,`secret-${fakeKey}`,{category:fakeKey,upstreamStatus:9999});assert.equal(rows[1].provider,'unknown');assert.equal(rows[1].model,'unknown');assert.equal(rows[1].category,'internal');assert.equal(rows[1].upstreamStatus,null);assert.notEqual(rows[1].requestId,id);
});
test('actual failing grade links safe server telemetry to error response without content',async()=>{
  const rows=[];console.warn=value=>rows.push(JSON.parse(value));globalThis.fetch=async()=>new Response(`private ${fakeKey}`,{status:429});
  let failure;try{await grade(actor,{graderKey:fakeKey,prompt:'private comparison prompt',responses:[{model:'private name',text:'private answer'}]});}catch(e){failure=e;}
  assert.equal(rows.length,1);assert.equal(rows[0].category,'upstream_http');assert.equal(rows[0].upstreamStatus,429);assert.equal(failure.requestId,rows[0].requestId);assert.ok(!JSON.stringify(rows).includes('private'));assert.ok(!JSON.stringify(rows).includes(fakeKey));
  const {route}=await import('../lib/http.js');const response=await route(async()=>{throw failure;})();const body=await response.json();assert.equal(response.status,502);assert.equal(body.requestId,failure.requestId);assert.ok(!JSON.stringify(body).includes(fakeKey));
});
