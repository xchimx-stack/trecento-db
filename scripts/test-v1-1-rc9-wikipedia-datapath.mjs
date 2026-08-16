import fs from 'node:fs';
import assert from 'node:assert/strict';
const api=fs.readFileSync(new URL('../server/v1/network-admin.js',import.meta.url),'utf8');
const viewer=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

// Server must not strip stored Wikipedia evidence from graph payload.
assert.ok(api.includes("return res.status(200).json(snap.payload);"));
assert.ok(!api.includes("if(!n.wikipedia_relationships_enabled&&payload)"));
assert.ok(!api.includes("const kept=sources.filter(x=>x!=='Wikipedia')"));

// Viewer must always calculate topology from ULAN+Manual only.
assert.ok(viewer.includes("function baseLayoutRelationshipRows()"));
assert.ok(viewer.includes('source==="ULAN"||source==="Manual"'));
assert.ok(viewer.includes("relationships:baseLayoutRelationshipRows()"));

// Wikipedia is retained separately and attached only after topology materialization.
const materialize=viewer.indexOf("materializeV1Graph();attachWikipediaOverlayEdges();");
assert.ok(materialize>=0);
assert.ok(viewer.includes("function attachWikipediaOverlayEdges()"));
assert.ok(viewer.includes('if(!sources.includes("Wikipedia"))continue;'));

// Checkbox visible/default OFF; toggling is render-only, never topology rebuild.
assert.ok(viewer.includes('if(wikiSource)wikiSource.style.display="";'));
assert.ok(viewer.includes("enabledEdgeSources.Wikipedia=false;"));
assert.ok(viewer.includes("if(wikiInput)wikiInput.checked=false;"));
assert.ok(!viewer.includes("rebuildGraphForSourceLayers(true)"));
assert.ok(api.includes("build_version:'1.1-rc9'"));
console.log("PASS full Wikipedia data path: server delivers -> layout excludes -> overlay retains -> checkbox render-only");
