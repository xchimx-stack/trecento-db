import fs from "node:fs";
const s=fs.readFileSync(new URL("../server/handlers/discovery-admit.js",import.meta.url),"utf8");
for(const needle of [
  'source:"ULAN",external_id:ulanId',
  '.from("external_ids")',
  '.select("artist_id")',
  '.update({ulan_id:ulanId})'
]){
  if(!s.includes(needle)) throw new Error(`missing admission identity fallback: ${needle}`);
}
const extLookup=s.indexOf('source:"ULAN",external_id:ulanId');
const insert=s.indexOf('.from("artists")\n      .insert({');
if(extLookup<0||insert<0||extLookup>insert) throw new Error("external-ID identity resolution must occur before artist insert");
console.log("v0.20.5 regression passed: admission resolves existing artists through authority IDs before insert.");
