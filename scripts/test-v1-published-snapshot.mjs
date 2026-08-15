import fs from 'node:fs';
const api=fs.readFileSync(new URL('../server/v1/network-admin.js',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('../public/admin-v1.html',import.meta.url),'utf8');
const viewer=fs.readFileSync(new URL('../public/v1.html',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../supabase/v1.0.4-published-network-snapshots.sql',import.meta.url),'utf8');
const checks=[
 ['snapshot table migration',migration.includes('v1_published_networks')&&migration.includes('payload jsonb')],
 ['publish action exists',api.includes("action==='publish-network'")&&api.includes('publishNetworkSnapshot')],
 ['graph reads snapshot',api.includes("if(action==='graph')")&&api.includes('publishedSnapshot(s,n)')],
 ['graph no live fallback',api.includes('has not been published yet')&&api.includes('needs_publish:true')],
 ['assertion scan scoped',api.includes(".in('focus_ulan_id',memberUlans)")],
 ['admin publish button',admin.includes('Build / rebuild viewer snapshot')&&admin.includes("id=\"publishNetwork\"")],
 ['admin publish helper',admin.includes('rebuildPublishedSnapshot')],
 ['viewer asks published graph',viewer.includes("Loading published network")],
];
let fail=0;for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${name}`);if(!ok)fail++}process.exit(fail?1:0);
