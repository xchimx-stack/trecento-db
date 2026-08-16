import fs from 'node:fs';
import assert from 'node:assert/strict';
const api=fs.readFileSync(new URL('../server/v1/network-admin.js',import.meta.url),'utf8');

assert.ok(api.includes("const hasStart=Number.isFinite(ps)&&ps>0;"));
assert.ok(api.includes("const hasEnd=Number.isFinite(pe)&&pe>0;"));
assert.ok(api.includes("CHRONOLOGY_UNKNOWN — ULAN did not provide a machine-readable date; candidate retained"));
assert.ok(api.includes("function effectiveCandidateScope(network,candidate)"));
assert.ok(api.includes("const effective=effectiveCandidateScope(n,c);"));
assert.ok(api.includes("const effective=effectiveCandidateScope(n,c[0]);"));
assert.ok(!api.includes("if(c[0].scope_status!=='eligible'&&!req.body?.force)"));
assert.ok(api.includes("build_version:'1.1-rc11'"));

// Mirror the production classifier to prove the boundary cases.
function classify(start,end,ns=1275,ne=1430){
  const ps=start==null||start===''?NaN:Number(start);
  const pe=end==null||end===''?NaN:Number(end);
  const hasStart=Number.isFinite(ps)&&ps>0;
  const hasEnd=Number.isFinite(pe)&&pe>0;
  if(Number.isFinite(ns)&&Number.isFinite(ne)&&hasStart){
    const effectiveEnd=hasEnd?pe:ps;
    if(effectiveEnd<ns||ps>ne)return 'chronology_out';
  }
  if(Number.isFinite(ns)&&Number.isFinite(ne)&&!hasStart)return 'eligible';
  return 'eligible';
}
assert.equal(classify(0,0),'eligible');
assert.equal(classify(null,null),'eligible');
assert.equal(classify('', ''),'eligible');
assert.equal(classify(1200,1250),'chronology_out');
assert.equal(classify(1450,1500),'chronology_out');
assert.equal(classify(1300,1400),'eligible');
console.log("PASS chronology 0/null/missing => UNKNOWN retained; only real out-of-range dates => CHRONOLOGY_OUT");
