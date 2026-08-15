const assert=require('assert');
function normalizeRelationship(type,currentId,relatedId){type=String(type||'').toLowerCase().trim();let from=currentId,to=relatedId,visual='dotted',directed=false;if(['student of','apprentice of','master was'].includes(type)){from=relatedId;to=currentId;visual='solid';directed=true}else if(['teacher of','apprentice was','master of'].includes(type)){visual='solid';directed=true}else if(type==='employee of'){from=relatedId;to=currentId;visual='solid';directed=true}else if(type==='employee was'){visual='solid';directed=true}else if(type==='influenced by'){from=relatedId;to=currentId;visual='dashed';directed=true}else if(type==='influenced'){visual='dashed';directed=true}return{from,to,visual_class:visual,directed,relationship_type:type}}
// Rembrandt (500011051) -> Gerrit Dou (500115513).
let r=normalizeRelationship('teacher of','500011051','500115513');assert.equal(r.from,'500011051');assert.equal(r.to,'500115513');
r=normalizeRelationship('student of','500115513','500011051');assert.equal(r.from,'500011051');assert.equal(r.to,'500115513');
// Otto van Veen (500005170) -> Peter Paul Rubens (500002921).
r=normalizeRelationship('teacher of','500005170','500002921');assert.equal(r.from,'500005170');assert.equal(r.to,'500002921');
r=normalizeRelationship('student of','500002921','500005170');assert.equal(r.from,'500005170');assert.equal(r.to,'500002921');
console.log('PASS ULAN directionality: Rembrandt→Dou and Van Veen→Rubens');