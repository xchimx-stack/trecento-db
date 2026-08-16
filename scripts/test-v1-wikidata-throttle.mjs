import fs from 'node:fs';
const s=fs.readFileSync(new URL('../server/v1/network-admin.js',import.meta.url),'utf8');
const a=fs.readFileSync(new URL('../public/admin-v1.html',import.meta.url),'utf8');
const checks=[
 ['429 retry handled',s.includes("r.status===429||r.status===503")&&s.includes("retryAfterMs(r,attempt)")],
 ['retry-after header used',s.includes("headers?.get?.('retry-after')")],
 ['maxlag enabled',s.includes("maxlag:5")],
 ['server pacing enabled',s.includes("WIKIDATA_MIN_INTERVAL_MS=450")&&s.includes("await wikidataPace()")],
 ['bounded exact P245 path',s.includes("haswbstatement:P245=${id}")],
 ['EN DE bounded fallback',s.includes("for(const lang of ['en','de'])")],
 ['admin inter-artist pause',a.includes("setTimeout(resolve,900)")],
 ['exact P245 validation retained',s.includes("wikidataClaimValues(e,'P245').includes(id)")]
];
let bad=0;for(const [n,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${n}`);if(!ok)bad++}process.exit(bad?1:0);
