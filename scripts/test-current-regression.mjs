import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const discover=fs.readFileSync(path.join(root,'public/discover.html'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const sql=fs.readFileSync(path.join(root,'supabase/v0.20.9-trecento-core-25.sql'),'utf8');
const checks=[
 ['version',pkg.version==='0.20.9'],
 ['Dutch defaults Core',html.includes('lowTier:1')],
 ['curated Trecento Core 25',html.includes('TRECENTO_CORE_25')&&html.includes('paolo veneziano')&&!html.includes('TRECENTO_CORE_25 = new Set([\n  "giottino"')],
 ['manual tiers respected',html.includes('manualTier==="core"')&&html.includes('manualTier==="expanded"')],
 ['scope changes preserve selection',html.includes('function changeNetworkTier')&&!html.includes('render();overview()')],
 ['selection never promotes scope',html.includes('Selection never changes scope')],
 ['city filter stable with selection',html.includes('if(hadSelection){ render(); return; }')],
 ['Trecento tier anchor stable',html.includes('const anchorScreen=selected?')&&html.includes('anchorScreen.x-selected.x*state.scale')],
 ['one-click expanded hit target',html.includes("class:'node-hit'")&&html.includes("hit.style.pointerEvents='all'")],
 ['stale drag suppression clears',html.includes('setTimeout(()=>{state.suppressNextClick=false},140)')],
 ['Dutch post-collision regional envelope',html.includes('Final geographic envelope after collision resolution')],
 ['Dutch diagnostics available',html.includes('__networkLayoutDiagnostics.lowCountries')],
 ['Dutch lines stronger',html.includes("isConnected?.92:.38")],
 ['existing incomplete resolver repair retained',discover.includes('existing record is incomplete; re-auditing')],
 ['bilingual Wikipedia evidence merge',discover.includes('evidence_languages')&&discover.includes('bundles.map(x=>x.extract')],
 ['Core-25 SQL exists',sql.includes("manual_tier = 'expanded'")&&sql.includes("manual_tier = 'core'")&&sql.toLowerCase().includes('paolo veneziano')]
];
for(const [n,ok] of checks) console.log(`${ok?'PASS':'FAIL'} ${n}`);
if(checks.some(([,ok])=>!ok)) process.exit(1);
console.log('PASS: v0.20.9 current regression');
