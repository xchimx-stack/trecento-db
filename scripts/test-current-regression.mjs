import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const discover=fs.readFileSync(path.join(root,'public/discover.html'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const lowCrawl=fs.readFileSync(path.join(root,'server/handlers/low-countries-crawl.js'),'utf8');
const lowAdmin=fs.readFileSync(path.join(root,'public/admin-low-countries.html'),'utf8');
const sql=fs.readFileSync(path.join(root,'supabase/v0.20.9-trecento-core-25.sql'),'utf8');
const checks=[
 ['version',pkg.version==='0.20.17'],
 ['Dutch defaults Core',html.includes('lowTier:1')],
 ['curated Trecento Core 25',html.includes('TRECENTO_CORE_25')&&html.includes('paolo veneziano')&&!html.includes('TRECENTO_CORE_25 = new Set([\n  "giottino"')],
 ['Trecento Expanded curated to 80',html.includes('TRECENTO_EXPANDED_TOTAL_TARGET=80')&&html.includes('TRECENTO_EXPANDED_FOUNDATION')],
 ['scope changes preserve selection',html.includes('function changeNetworkTier')&&!html.includes('render();overview()')],
 ['selection never promotes scope',html.includes('Selection never changes scope')],
 ['city filter stable with selection',html.includes('if(hadSelection){ render(); return; }')],
 ['Trecento tier anchor stable',html.includes('const viewport={scale:state.scale,tx:state.tx,ty:state.ty}')&&html.includes('animateExpandedMode(nextTier>1,false,viewport)')],
 ['circle-only hit target',!html.includes("class:'node-hit'")&&html.includes("const nodeCircle=svgEl('circle'")&&html.includes("nodeCircle.addEventListener('pointerdown'")&&html.includes('.node text{fill:#222;font-size:13px;font-weight:600;pointer-events:none}')],
 ['single-click node selection on pointerdown',html.includes("nodeCircle.addEventListener('pointerdown',(ev)=>{")&&html.includes("selectArtist(a.id);")],
 ['stale drag suppression clears',html.includes('setTimeout(()=>{state.suppressNextClick=false},140)')],
 ['Dutch all-node envelope removed',!html.includes('Constrain every node to a generous regional envelope')],
 ['Dutch post-layout regional clamp removed',!html.includes('const sparseNodes=nodes.filter')&&!html.includes('clampSparseToRegion')],
 ['Dutch lines stronger',html.includes("isConnected?.92:.38")],
 ['existing incomplete resolver repair retained',discover.includes('existing record is incomplete; re-auditing')],
 ['bilingual Wikipedia evidence merge',discover.includes('evidence_languages')&&discover.includes('bundles.map(x=>x.extract')],
 ['methodology current',html.includes('Methodology version 0.20.17')],
 ['ULAN place fallback wired',html.includes('ULAN active location')&&html.includes('rec.birth_place')&&html.includes('rec.death_place')],
 ['ULAN dotted relationship parser repaired',lowCrawl.includes('Getty\'s rendered ULAN text uses dotted leaders twice')&&lowCrawl.includes('{1,420}?')],
 ['relationship repair admin action',lowAdmin.includes('Repair relationship rows')&&lowAdmin.includes('Relationship degree audit')&&lowAdmin.includes('relations seed')],
 ['dedicated ULAN place refresh',lowCrawl.includes('refresh-places-seed')&&lowCrawl.includes('refresh-places-candidate')&&lowAdmin.includes('refresh-places-seed')&&lowAdmin.includes('refresh-places-candidate')],
 ['Unknown seed geography replaceable',lowCrawl.includes('function usableGeoBucket')&&lowCrawl.includes('!/^unknown$/i.test(s)')],
 ['graph response-time place fallback',fs.readFileSync(path.join(root,'api/graph.js'),'utf8').includes('fallbackLowCountriesGeo')&&fs.readFileSync(path.join(root,'api/graph.js'),'utf8').includes('ULAN death place fallback')],
 ['duplicate ULAN place evidence merged',fs.readFileSync(path.join(root,'api/graph.js'),'utf8').includes('merge richer ULAN place evidence')],
 ['Low Countries workshop geography fallback',fs.readFileSync(path.join(root,'api/graph.js'),'utf8').includes('workshop / parent-node fallback')],
 ['Trecento connected unmapped enrichment',html.includes('slice(0,40)')&&!html.includes('if(d!==0) return false')],
 ['Trecento relationship placement fallback',html.includes('applyTrecentoRelationshipPlacementFallbacks')&&html.includes('workshop-neighbor layout fallback')],
 ['Low Countries Wikidata/VIAF drawer parity',html.includes('selectedRec.wikidata_url')&&html.includes('selectedRec.viaf_url')],
 ['Wikipedia source labeled beta',html.includes('Wikipedia (BETA)')&&html.includes('sourceName==="Wikipedia"?"Wikipedia (BETA)"')],
 ['Trecento ULAN-only inferred placement',html.includes('if(!relationshipSources(rel).includes("ULAN")) continue;')],
 ['tier switches preserve exact viewport',html.includes('Object.assign(state,viewport);render();')&&html.includes('preservedViewport')],
 ['Low Countries status beta removed',!html.includes('BETA · ${shown} of ${artists.length} mapped artists')],
 ['Core-25 SQL exists',sql.includes("manual_tier = 'expanded'")&&sql.includes("manual_tier = 'core'")&&sql.toLowerCase().includes('paolo veneziano')]
];
for(const [n,ok] of checks) console.log(`${ok?'PASS':'FAIL'} ${n}`);
if(checks.some(([,ok])=>!ok)) process.exit(1);
console.log('PASS: v0.20.17 current regression');
