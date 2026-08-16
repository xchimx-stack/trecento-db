import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {normalizePlaceLabel}=require('../server/v1/ulan.js');
const api=fs.readFileSync(new URL('../server/v1/network-admin.js',import.meta.url),'utf8');
const viewer=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

assert.equal(normalizePlaceLabel('1288-1324'),null);
assert.equal(normalizePlaceLabel('active by 1353'),null);
assert.equal(normalizePlaceLabel('1341-1347 Assisi (Perugia province, Umbria, Italy) (inhabited place)'),'Assisi');
assert.equal(normalizePlaceLabel('1355-1389 Siena (Siena province, Tuscany, Italy) (inhabited place)'),'Siena');
assert.equal(normalizePlaceLabel('he was at the Papal court in Avignon in 1342'),null);
assert.equal(normalizePlaceLabel('Italy'),null);

const ai=api.indexOf("if(active.length)return {city:active[0],source:'ULAN active location'");
const di=api.indexOf("if(death)return {city:death,source:'ULAN death place fallback'");
const bi=api.indexOf("if(birth)return {city:birth,source:'ULAN birth place fallback'");
assert.ok(ai>=0&&di>ai&&bi>di);
assert.ok(api.includes("family==='collaboration'"));
assert.ok(api.includes("artist.geography_source='ULAN/Manual collaboration fallback'"));
assert.ok(api.includes("o?.region?'Manual override':geo.source"));
assert.ok(api.includes("build_version:'1.1-rc7'"));

assert.ok(viewer.includes("function baseLayoutRelationshipRows()"));
assert.ok(viewer.includes('source=>"ULAN"') || viewer.includes('source==="ULAN"'));
assert.ok(viewer.includes('source==="ULAN"||source==="Manual"'));
assert.ok(viewer.includes("function attachWikipediaOverlayEdges()"));
assert.ok(viewer.includes("attachWikipediaOverlayEdges();"));
assert.ok(!viewer.includes("rebuildGraphForSourceLayers(true)"));
assert.ok(viewer.includes("Wikipedia is a")&&viewer.includes("display-only overlay"));
console.log("PASS generic geography hierarchy and Wikipedia display-only layout isolation");
