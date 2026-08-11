import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const discover=fs.readFileSync(path.join(root,'public/discover.html'),'utf8');
const admit=fs.readFileSync(path.join(root,'server/handlers/discovery-admit.js'),'utf8');
const graph=fs.readFileSync(path.join(root,'api/graph.js'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const checks=[
 ['version',pkg.version==='0.20.8'],
 ['overview removed',!html.includes('id="homeBtn"')],
 ['methodology footer link',html.includes('id="methodologyLink"')&&!html.includes('id="methodologyBtn"')],
 ['drawer collapse tab',html.includes('id="drawerToggle"')&&!html.includes('id="closeDrawer"')&&html.includes("drawer.classList.toggle('collapsed')")],
 ['city filtering preserves selection',html.includes('preserveSelectionContext')&&html.includes('fitVisibleGraph({preserveDrawer:true')],
 ['gentle click-safe atmosphere',html.includes('const maxWorld=4.5/scale')&&html.includes('d<=deadZone')],
 ['stronger Dutch edges',html.includes('body.low-countries-mode .edge{opacity:.72}')&&html.includes("isConnected?.86:.30")],
 ['Dutch outlier geography correction',html.includes("name.includes('teniers')")&&html.includes("name.includes('vermeer')")],
 ['substantive body image rule',html.includes("action:\"parse\"")&&html.includes('mw-file-description')&&html.includes('if(!files.length) return null')],
 ['existing incomplete records re-audited',discover.includes('existing record is incomplete; re-auditing')],
 ['Wikidata place evidence',discover.includes('function wikidataPlaceEvidence')&&discover.includes("['P937',5,'work location']")],
 ['existing placement repair',admit.includes('repairedExisting')&&admit.includes('updated_existing')],
 ['bad year/malformed graph records excluded',graph.includes('obviousBadEntity')],
 ['cleanup SQL exists',fs.existsSync(path.join(root,'supabase/v0.20.8-cleanup-bad-admissions.sql'))]
];
for(const [n,ok] of checks) console.log(`${ok?'PASS':'FAIL'} ${n}`);
if(checks.some(([,ok])=>!ok))process.exit(1);
console.log('PASS: v0.20.8 consolidated interface/resolver/layout regression');
