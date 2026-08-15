import fs from 'node:fs';
const api=fs.readFileSync(new URL('../server/v1/network-admin.js',import.meta.url),'utf8');
const checks=[
 ['no invalid embedded override join',!api.includes("v1_artists(*),v1_curatorial_overrides(*)")],
 ['membership artist join retained',api.includes(".select('*,v1_artists(*)')")],
 ['overrides fetched separately',api.includes("from('v1_curatorial_overrides').select('*').eq('network_id',network.id).in('artist_id',artistIds)")],
 ['overrides merged by artist id',api.includes('overrideBy=new Map(overrides.map(x=>[x.artist_id,x]))')&&api.includes('overrideBy.get(a.id)')]
];
let fail=0;for(const [n,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${n}`);if(!ok)fail++}process.exit(fail?1:0);
