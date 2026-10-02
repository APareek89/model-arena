// Fixture-only external transport fixture. Never imported by app source.
const fs = require('node:fs');
const net = require('node:net');
const dns = require('node:dns');
const dgram = require('node:dgram');
const path = require('node:path');
const crypto = require('node:crypto');
const auditFile = process.env.MODEL_ARENA_FIXTURE_AUDIT;
if (!auditFile || !path.isAbsolute(auditFile)) throw new Error('Explicit private fixture audit file required');
const audit = event => fs.appendFileSync(auditFile, JSON.stringify({at:new Date().toISOString(), pid:process.pid, ...event})+'\n', {mode:0o600});
const loopback = host => ['localhost','127.0.0.1','::1','[::1]'].includes(host);
function denyDns() {audit({event:'external_dns_denied'});throw new Error('Fixture denies external DNS');}
// No resolver can escape the fetch fixture through a direct DNS call. Literal
// loopback lookup is resolved locally, without consulting DNS servers.
dns.lookup = (hostname,options,callback) => {
  if (!loopback(hostname)) return denyDns();
  if (typeof options==='function') {callback=options;options={};}
  options ||= {};
  const family=options.family===6 || hostname==='::1' || hostname==='[::1]' ? 6 : 4;
  const address=family===6?'::1':'127.0.0.1';
  queueMicrotask(()=>options.all?callback(null,[{address,family}]):callback(null,address,family));
};
dns.promises.lookup = async (hostname,options={}) => {
  if (!loopback(hostname)) return denyDns();
  const family=options.family===6 || hostname==='::1' || hostname==='[::1]' ? 6 : 4;
  const result={address:family===6?'::1':'127.0.0.1',family};return options.all?[result]:result;
};
for (const target of [dns,dns.promises,dns.Resolver.prototype,dns.promises.Resolver.prototype]) {
  for (const name of Object.getOwnPropertyNames(target)) {
    if (name.startsWith('resolve') || name==='reverse' || name==='lookupService') target[name]=denyDns;
  }
}
dgram.Socket.prototype.send = function() {audit({event:'udp_socket_denied'});throw new Error('Fixture denies UDP sockets');};
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
  let opts=args[0];
  if (Array.isArray(opts)) opts=opts[0];
  let host = typeof opts==='object' && opts ? opts.host : typeof args[1]==='string' ? args[1] : 'localhost';
  if (typeof opts==='object' && opts && opts.path) return connect.apply(this,args); // Local IPC only.
  host ||= 'localhost';
  if (!loopback(host)) {audit({event:'external_socket_denied'}); throw new Error('Fixture denies every external socket');}
  return connect.apply(this,args);
};
const originalFetch=globalThis.fetch;
const fixtureCases=JSON.parse(fs.readFileSync(path.join(__dirname,'session-proxy.json'),'utf8')).cases;
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
globalThis.fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url);
  if(loopback(url.hostname))return originalFetch(input,init);
  const method=init.method||'GET';
  if(url.origin==='https://router.huggingface.co'&&url.pathname==='/v1/models'&&method==='GET')return reply({data:['Qwen/Qwen3-4B-Instruct-2507','meta-llama/Llama-3.1-8B-Instruct'].map(id=>({id,providers:[{provider:'nscale',status:'live',pricing:{input:.01,output:.03}}]}))});
  const body=JSON.parse(init.body||'{}');
  if(url.origin==='https://router.huggingface.co'&&url.pathname==='/v1/chat/completions'&&method==='POST'){
    const text=body.messages?.at(-1)?.content||'';audit({event:'fixture_generate',real_provider_calls:0});
    return reply({model:body.model,choices:[{finish_reason:text.includes('__FIXTURE_TRUNCATE__')?'length':'stop',message:{content:text.includes('Inception')?'Christopher Nolan':'[Offline provider fixture] A bounded comparison answer, not real model inference.'}}],usage:{prompt_tokens:10,completion_tokens:20}});
  }
  const provider=url.origin==='https://generativelanguage.googleapis.com'&&/^\/v1beta\/models\/[a-z0-9.-]+:generateContent$/.test(url.pathname)?'gemini':url.origin==='https://api.openai.com'&&url.pathname==='/v1/chat/completions'?'openai':url.origin==='https://api.anthropic.com'&&url.pathname==='/v1/messages'?'claude':null;
  if(!provider||method!=='POST'){audit({event:'external_fetch_denied'});throw Error('Fixture denies external fetch');}
  const header=provider==='gemini'?init.headers['x-goog-api-key']:provider==='openai'?init.headers.Authorization:init.headers['x-api-key'];
  if(header!==(provider==='openai'?'Bearer offline-fixture-key-only':'offline-fixture-key-only'))throw Error('Only the explicit synthetic fixture credential is allowed');
  const prompt=provider==='gemini'?body.contents[0].parts[0].text:body.messages.at(-1).content;
  audit({event:'fixture_grade',provider,real_provider_calls:0});
  const failure=/__FIXTURE_GRADE_(400|401|403|404|429|503)__/.exec(prompt);if(failure)return reply({error:{message:'Synthetic provider rejection'}},Number(failure[1]));
  const fixture=fixtureCases.find(f=>prompt.includes('QUESTION:\n'+f.prompt+'\n')||prompt.includes('QUESTION:\n'+f.prompt+'\n\n'));
  const sections=[...prompt.matchAll(/(?:^|\n\n)ANSWER ([ABC]):\n([\s\S]*?)(?=\n\nANSWER [ABC]:|$)/g)];const remaining=[...(fixture?.responses||[])];
  const rows=sections.map(([,label,text])=>{const i=remaining.findIndex(x=>(x.text||'(empty answer)')===text);return {label,source:i>=0?remaining.splice(i,1)[0]:null};});
  const scores=rows.map(row=>({label:row.label,...(row.source?.proxy_score||{accuracy:8,helpfulness:8,format:8}),reason:row.source?.proxy_reason||'Synthetic fixture score; no model was called.'}));
  const best=rows.find(r=>r.source?.model===fixture?.best)?.label||rows[0]?.label;
  const content=prompt.includes('__FIXTURE_BAD_JSON__')?'invalid JSON':JSON.stringify({scores,best});
  return reply(provider==='gemini'?{candidates:[{finishReason:'STOP',content:{parts:[{text:content}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:20}}:provider==='openai'?{choices:[{finish_reason:'stop',message:{content}}],usage:{prompt_tokens:10,completion_tokens:20}}:{stop_reason:'end_turn',content:[{type:'text',text:content}],usage:{input_tokens:10,output_tokens:20}});
};
audit({event:'fixture_transport_installed',real_provider_calls:0});
