const assert=require('assert');
const {normalizeByRule}=require('../server/v1/relationship-normalizer.js');
function rule(direction_mode,family='training',directed=true,visual='solid',eligible=true){return {direction_mode,normalized_family:family,directed,visual_class:visual,expansion_eligible:eligible}}
const giotto='500115588',taddeo='500019662';
let x=normalizeByRule({focus_ulan:giotto,related_ulan:taddeo,raw_qualifier:'teacher of'},rule('focus_to'));
assert.equal(x.canonical_from_ulan,giotto);assert.equal(x.canonical_to_ulan,taddeo);
x=normalizeByRule({focus_ulan:taddeo,related_ulan:giotto,raw_qualifier:'student of'},rule('counterpart_to'));
assert.equal(x.canonical_from_ulan,giotto);assert.equal(x.canonical_to_ulan,taddeo);
const rembrandt='500011051',dou='500011926';
x=normalizeByRule({focus_ulan:rembrandt,related_ulan:dou,raw_qualifier:'teacher of'},rule('focus_to'));
assert.equal(x.canonical_from_ulan,rembrandt);assert.equal(x.canonical_to_ulan,dou);
x=normalizeByRule({focus_ulan:dou,related_ulan:rembrandt,raw_qualifier:'student of'},rule('counterpart_to'));
assert.equal(x.canonical_from_ulan,rembrandt);assert.equal(x.canonical_to_ulan,dou);
const a='500000001',b='500000002';
x=normalizeByRule({focus_ulan:b,related_ulan:a,raw_qualifier:'sibling of'},rule('symmetric','family',false,'dotted'));
assert.equal(x.canonical_from_ulan,a);assert.equal(x.canonical_to_ulan,b);assert.equal(x.directed,false);
console.log('PASS: v1 qualifier normalization is deterministic and reciprocal-safe');
