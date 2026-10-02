// Local-only normal-auth server exercising real adapters with intercepted provider wires.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
const file=process.env.MODEL_ARENA_TEST_ENV;
if(!file)throw Error('MODEL_ARENA_TEST_ENV must name the private isolated test environment JSON');
const config=JSON.parse(readFileSync(file,'utf8'));
const db=new URL(config.DATABASE_URL);
if(db.hostname!=='127.0.0.1'||!db.pathname.endsWith('_test'))throw Error('Only an isolated loopback _test database is allowed');
for(const key of Object.keys(config))if(/KEY|TOKEN/.test(key))throw Error('Provider credentials are forbidden in the fixture environment');
const port=Number(process.env.MODEL_ARENA_QA_PORT||8995);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local port');
const audit=process.env.MODEL_ARENA_FIXTURE_AUDIT;if(!audit)throw Error('An explicit external MODEL_ARENA_FIXTURE_AUDIT path is required');
const inherited=Object.fromEntries(['PATH','HOME','TMPDIR','USER','SHELL'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
const env={...inherited,...config,NODE_ENV:'development',PUBLIC_ORIGIN:`http://127.0.0.1:${port}`,AUTH_URL:`http://127.0.0.1:${port}`,MODEL_ARENA_LOCAL_PREVIEW:'0',MODEL_ARENA_MOCK_MODE:'0',MODEL_ARENA_DIST_DIR:'.next-fmea-wire',HF_TOKEN:'offline-fixture-key-only',NEXT_TELEMETRY_DISABLED:'1',MODEL_ARENA_FIXTURE_AUDIT:resolve(audit),NODE_OPTIONS:`--require=${resolve('tests/fixtures/network-guard.cjs')}`};
console.log(`Offline adapter fixtures only: http://127.0.0.1:${port}; no real provider calls permitted. UI live-mode label describes the adapter path, not actual network inference.`);
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',String(port)],{env,stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code||0));
