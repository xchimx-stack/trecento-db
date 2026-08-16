import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
const require=createRequire(import.meta.url);
const {normalizePlaceLabel}=require('../server/v1/ulan.js');

assert.equal(normalizePlaceLabel('1288-1324'),null);
assert.equal(normalizePlaceLabel('1317-ca. 1350'),null);
assert.equal(normalizePlaceLabel('1341-1347 Assisi (Perugia province, Umbria, Italy) (inhabited place)'),'Assisi');
assert.equal(normalizePlaceLabel('1355-1389 Siena (Siena province, Tuscany, Italy) (inhabited place)'),'Siena');
assert.equal(normalizePlaceLabel('Florence (Tuscany, Italy) (inhabited place)'),'Florence');
assert.equal(normalizePlaceLabel('Padua (Veneto, Italy)'),'Padua');

const api=fs.readFileSync(new URL('../server/v1/network-admin.js',import.meta.url),'utf8');
const viewer=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
assert.ok(api.includes(".map(normalizePlaceLabel).filter(Boolean)"));
assert.ok(api.includes("birthPlace=normalizePlaceLabel(pr.birth_place)"));
assert.ok(!viewer.includes("preferredTrecento=['Florence'"));
assert.ok(api.includes("build_version:'1.1-rc5'"));
console.log('PASS ULAN city/place normalization and cached-snapshot repair');
