import fs from 'node:fs';
const v=fs.readFileSync(new URL('../public/v1.html',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../server/v1/network-admin.js',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('../public/admin-v1.html',import.meta.url),'utf8');
const mig=fs.readFileSync(new URL('../supabase/v1.0.7-ui-media-parity.sql',import.meta.url),'utf8');
const checks=[
 ['cursor repulsion',v.includes('pointerWorld')&&v.includes('1-d/limit')],
 ['ambient movement',v.includes('requestAnimationFrame(animate)')&&v.includes('resolveCollisions')],
 ['circle-only interaction',v.includes('dataset.nodeId')&&v.includes('pointer-events:all')&&v.includes('pointer-events:none')],
 ['mobile pan tap distinction',v.includes('Math.hypot(e.clientX-tapCandidate.x')&&v.includes("pointerType!=='touch'" )],
 ['collapsible drawer',v.includes('drawerToggle')&&v.includes("classList.toggle('collapsed')")],
 ['selection neighbor fade',v.includes("classList.toggle('dim'")&&v.includes('neighbors.add')],
 ['directed arrows',v.includes('marker-end')&&v.includes('arrow-${r.source')],
 ['line clipping',v.includes('function clippedLine')&&v.includes('nodeRadius(q.a)')],
 ['parallel relationship offsets',v.includes('pairIndex')&&v.includes('pairTotal')],
 ['dense overflow',v.includes('ADDITIONAL')&&v.includes('overflowEdges')],
 ['search',v.includes('Jump to an artist')&&v.includes('jumpToArtist')],
 ['unmapped drawer',v.includes('Unmapped artists')&&v.includes('fillUnmapped')],
 ['viewport preserved on filters',!v.includes("fitCore();refreshScene")&&v.includes("tier=b.dataset.tier")],
 ['cached thumbnail only',v.includes('a.thumbnail_url')&&!v.includes('thumbnail_source_url')],
 ['no live Wikipedia viewer fetch',!v.includes('wikipedia.org/w/api.php')&&!v.includes('upload.wikimedia.org')],
 ['media admin UI',admin.includes('Wikipedia media cache')&&admin.includes('refreshMediaDue')],
 ['media resolve endpoint',api.includes("action==='media-refresh-one'")&&api.includes('resolveWikipediaMedia')],
 ['supabase storage upload',api.includes("storage.from(MEDIA_BUCKET).upload")],
 ['90 day revalidation',api.includes('MEDIA_RECHECK_DAYS=90')&&api.includes('next_check_at')],
 ['50 percent storage cutoff',api.includes('MEDIA_DEFAULT_CAP_BYTES*0.50')],
 ['public snapshot uses storage only',api.includes('thumbnail_url:mc.storage_path?')&&!api.includes('publicUrl||mc.thumbnail_source_url')],
 ['media migration',mig.includes("'v1-media'")&&mig.includes('file_size_bytes')]
];
let fail=0;for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${name}`);if(!ok)fail++}process.exit(fail?1:0);
