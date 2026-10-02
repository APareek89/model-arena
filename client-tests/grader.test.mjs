import test from 'node:test';
import assert from 'node:assert/strict';
import { GRADER_PROVIDERS, graderProblem, graderSelection, finishWarning } from '../app/client/grader.mjs';
import { parsePromptFile } from '../app/client/workspace.mjs';
for(const provider of GRADER_PROVIDERS)test(`Configure ${provider.id} allows listed models and requires key`,()=>{
  for(const model of provider.models){assert.equal(graderSelection(provider.id,model),true);assert.match(graderProblem(provider.id,model,''),/Configure/);assert.equal(graderProblem(provider.id,model,'offline-only-key'),null);}
  assert.equal(graderSelection(provider.id,'unverified-model'),false);
});
test('generation truncation has an explicit partial-answer explanation',()=>{
  assert.match(finishWarning('length'),/partial answer/);assert.match(finishWarning('max_tokens'),/token limit/);assert.match(finishWarning('content_filter'),/Inspect/);assert.equal(finishWarning('stop'),null);assert.equal(finishWarning(null),null);
});
for(const [name,value] of Object.entries({objectPrompt:[{prompt:{bad:true}}],numericPrompt:[{prompt:123}],objectReference:[{prompt:'Q',reference:{}}],numericID:[{id:5,prompt:'Q'}],delimiterID:[{id:'q|m',prompt:'Q'}],controlID:[{id:'q\n',prompt:'Q'}]}))test(`prompt import rejects ${name} rather than coercing or colliding`,()=>assert.throws(()=>parsePromptFile(JSON.stringify(value))));
test('prompt import rejects oversized UTF8 files before JSON parsing',()=>{
  assert.throws(()=>parsePromptFile('é'.repeat(1024*1024+1)),/2 MiB/);
});
test('maximum90-job batch stays at3workers and completes every item once',async()=>{
  const {runQueue}=await import('../app/client/workspace.mjs');let active=0,peak=0;const completed=[];
  await runQueue(Array.from({length:90},(_,i)=>i),3,async i=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,1));completed.push(i);active--;});
  assert.equal(peak,3);assert.equal(new Set(completed).size,90);assert.equal(completed.length,90);
});
test('numeric reference values are not silently coerced',()=>assert.throws(()=>parsePromptFile(JSON.stringify([{prompt:'Q',reference:42}])),/must be text/));
test('competing FileReader completions apply only the latest selection per input kind',async()=>{
  const {createImportGate}=await import('../app/client/workspace.mjs');const gate=createImportGate();let prompts='old',corpus='old';
  const first=gate.begin('prompts');const second=gate.begin('prompts');const corpusRead=gate.begin('corpus');
  if(second())prompts='newer file';if(first())prompts='stale file';if(corpusRead())corpus='separate file';
  assert.equal(prompts,'newer file');assert.equal(corpus,'separate file');
});
test('workspace invalidation blocks both pending imports and permits a fresh selection',async()=>{
  const {createImportGate}=await import('../app/client/workspace.mjs');
  const gate=createImportGate();const older=gate.begin('prompts');const corpus=gate.begin('corpus');
  gate.invalidateAll();let applied=false;if(older()||corpus())applied=true;
  assert.equal(applied,false);assert.equal(gate.begin('prompts')(),true);
});
test('persisted object children and malformed scores become recoverable errors instead of React crashes',async()=>{
  const {readWorkspace}=await import('../app/client/workspace.mjs');
  const saved={models:['m'],system:'',corpus:'',prompts:[{id:'q',prompt:'Q'}],graderKey:'MUST-NOT-RESTORE',results:{bad:{status:'done',text:{private:'object'}},badError:{status:'error',error:{private:'object'}},good:{status:'done',text:'Preserved',ms:4,usage:{completion_tokens:{bad:true},prompt_tokens:10},rawSecret:'MUST-NOT-RESTORE'}},grades:{q:{status:'done',grader:'gemini-2.5-flash-lite',best:'m',scores:{m:{accuracy:10,helpfulness:10,format:10,reason:{bad:true}}}}}};
  const restored=readWorkspace({getItem:()=>JSON.stringify(saved)},'fixture');
  assert.equal(restored.results.bad.status,'error');assert.equal(typeof restored.results.badError.error,'string');assert.equal(restored.results.good.text,'Preserved');assert.equal(restored.results.good.usage.prompt_tokens,10);assert.equal(restored.results.good.usage.completion_tokens,undefined);assert.equal(restored.grades.q.status,'error');assert.ok(!JSON.stringify(restored).includes('MUST-NOT-RESTORE'));
});
test('valid persisted grades recompute numeric overall and retain unknown BYOK cost',async()=>{
  const {restoreEntries}=await import('../app/client/workspace.mjs');
  const item={status:'done',grader:'gpt-4.1-mini',provider:'openai',best:'m',scores:{m:{accuracy:8,helpfulness:9,format:10,reason:'Valid',overall:{bad:true}}},billing:{source:'user_key',costUSD:0},usage:{input_tokens:10,output_tokens:20}};
  const r=restoreEntries({q:item},true).q;assert.equal(r.status,'done');assert.equal(r.scores.m.overall,9);assert.equal(r.billing.costUSD,null);assert.equal(Object.getPrototypeOf(r.scores),null);
  for(const scores of [null,[],{m:null},{m:{accuracy:11,helpfulness:9,format:10,reason:'bad'}}])assert.equal(restoreEntries({q:{...item,scores}},true).q.status,'error');
  assert.throws(()=>restoreEntries([]),/Invalid saved results/);
});
