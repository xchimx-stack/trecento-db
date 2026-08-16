import fs from 'node:fs';
const prod=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const v1=fs.readFileSync(new URL('../public/v1.html',import.meta.url),'utf8');
const shared=['function atmosphericPosition(a)','function runAtmosphereFrame()','function applyViewPositions()','function clippedEdge(from,to,directed=false)','function populateDrawer(a)','function navigateRelationship(other)','function animateExpandedMode(','drawerToggle','relationshipKeyBtn','overflowDrawer','artistListDrawer','touchPointers:new Map()','SOURCE_STRIPE_WIDTH'];
let fail=0;for(const x of shared){const ok=prod.includes(x)&&v1.includes(x);console.log(`${ok?'PASS':'FAIL'} ${x}`);if(!ok)fail++}
const extra=[['v1 graph endpoint',v1.includes('/api/v1?action=graph&network=')],['cached media',v1.includes('rec?.thumbnail_url')],['generic materializer',v1.includes('function materializeV1Graph()')],['transplant marker',v1.includes('UI transplant source: public/index.html production renderer')]];
for(const [n,ok] of extra){console.log(`${ok?'PASS':'FAIL'} ${n}`);if(!ok)fail++}process.exit(fail?1:0);