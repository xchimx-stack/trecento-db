import fs from 'node:fs';
import assert from 'node:assert/strict';
const viewer=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../server/v1/network-admin.js',import.meta.url),'utf8');

assert.ok(viewer.includes('if(wikiSource)wikiSource.style.display="";'));
assert.ok(viewer.includes("enabledEdgeSources.Wikipedia=false;"));
assert.ok(viewer.includes("if(wikiInput)wikiInput.checked=false;"));
assert.ok(!viewer.includes('wikiSource.style.display=V1_NETWORK.wikipedia_relationships_enabled'));
assert.ok(viewer.includes("function attachWikipediaOverlayEdges(){"));
assert.ok(!viewer.includes("if(!V1_NETWORK?.wikipedia_relationships_enabled)return;"));
assert.ok(viewer.includes('if(input.value==="Wikipedia")')===false);
assert.ok(!viewer.includes("rebuildGraphForSourceLayers(true)"));
assert.ok(viewer.includes('source==="ULAN"||source==="Manual"'));
assert.ok(api.includes("build_version:'1.1-rc8'"));
console.log("PASS Wikipedia control visible, default OFF, overlay available, layout remains ULAN+Manual only");
