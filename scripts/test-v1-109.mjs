import fs from 'node:fs';
const v=fs.readFileSync(new URL('../public/v1.html',import.meta.url),'utf8');
const a=fs.readFileSync(new URL('../public/admin-v1.html',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../server/v1/network-admin.js',import.meta.url),'utf8');
const checks=[
 ['dropdown selector',v.includes('id="networkSelect"')&&v.includes('Select network')],
 ['no auto first network',v.includes('V1_NETWORK=V1_NETWORK_KEY?')&&v.includes('return false')],
 ['topology components',v.includes('Connected components: topology is the first organizing principle.')],
 ['long edge pressure',v.includes('if(d>260)')],
 ['component packing',v.includes('Pack components compactly')],
 ['cached image immediate',v.includes('setThumb("thumb1",rec?.thumbnail_url||null)')&&!v.includes('if(mediaAbortController)')],
 ['wiki button cached',v.includes('wikiLink.href=rec.wikipedia_url')],
 ['admin close network',a.includes('id="closeNetwork"')&&a.includes("$('closeNetwork').onclick")],
 ['english wiki first',api.includes("const langs=['en',preferredLanguage")]
];let fail=0;for(const [n,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${n}`);if(!ok)fail++}process.exit(fail?1:0);