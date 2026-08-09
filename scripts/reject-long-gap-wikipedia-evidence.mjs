import { createClient } from "@supabase/supabase-js";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY;
if(!url||!secret){
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY");
  process.exit(1);
}

const supabase=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const JOB_SOURCE="Wikipedia 50-year evidence cleanup v1";

const {data:done,error:doneErr}=await supabase
  .from("crawl_runs")
  .select("id")
  .eq("source",JOB_SOURCE)
  .eq("status","completed")
  .limit(1);
if(doneErr) throw doneErr;
if(done?.length){
  console.log("Wikipedia 50-year evidence cleanup already completed; skipping.");
  process.exit(0);
}

const {data:run,error:runErr}=await supabase
  .from("crawl_runs")
  .insert({source:JOB_SOURCE,status:"running"})
  .select("id").single();
if(runErr) throw runErr;

const [
  {data:artists,error:aErr},
  {data:rels,error:rErr},
  {data:evidence,error:eErr}
]=await Promise.all([
  supabase.from("artists")
    .select("id,canonical_name,layout_year,birth_year,death_year,floruit_start,floruit_end"),
  supabase.from("relationships")
    .select("id,from_artist_id,to_artist_id,relationship_type,review_status"),
  supabase.from("relationship_evidence")
    .select("id,relationship_id,source,review_status")
]);

if(aErr) throw aErr;
if(rErr) throw rErr;
if(eErr) throw eErr;

const byArtist=new Map((artists||[]).map(a=>[a.id,a]));
const evByRel=new Map();
for(const e of evidence||[]){
  if(!evByRel.has(e.relationship_id)) evByRel.set(e.relationship_id,[]);
  evByRel.get(e.relationship_id).push(e);
}

function year(a){
  const vals=[
    a?.layout_year,
    a?.floruit_start,
    a?.birth_year,
    a?.floruit_end,
    a?.death_year
  ].filter(Number.isFinite);
  return vals.length?vals[0]:null;
}

const familyTypes=new Set([
  "child of","parent of","sibling of","brother of","son of","father of"
]);

let reviewed=0;
let evidenceRejected=0;
let relationshipsRejected=0;
const details=[];

for(const r of rels||[]){
  const ev=evByRel.get(r.id)||[];
  const wiki=ev.filter(e=>e.source==="Wikipedia" && !String(e.review_status||"").startsWith("rejected"));
  if(!wiki.length) continue;

  const type=String(r.relationship_type||"").toLowerCase();
  if(familyTypes.has(type)) continue;

  const from=byArtist.get(r.from_artist_id);
  const to=byArtist.get(r.to_artist_id);
  if(!from||!to) continue;

  const fy=year(from),ty=year(to);
  if(!Number.isFinite(fy)||!Number.isFinite(ty)) continue;

  reviewed++;
  const diff=Math.abs(ty-fy);
  if(diff<=50) continue;

  for(const e of wiki){
    const {error:uErr}=await supabase
      .from("relationship_evidence")
      .update({review_status:"rejected_chronology"})
      .eq("id",e.id);
    if(uErr) throw uErr;
    evidenceRejected++;
  }

  const survivingNonRejected=ev.filter(e=>
    e.source!=="Wikipedia" && !String(e.review_status||"").startsWith("rejected")
  );

  // If Wikipedia was the only surviving evidence source, hide the relationship
  // itself. If ULAN (or future RKD) supports it, retain the relationship.
  if(!survivingNonRejected.length){
    const {error:rUErr}=await supabase
      .from("relationships")
      .update({review_status:"rejected_chronology"})
      .eq("id",r.id);
    if(rUErr) throw rUErr;
    relationshipsRejected++;
  }

  details.push(`${from.canonical_name} -> ${to.canonical_name}: ${type}; gap=${diff}`);
}

await supabase.from("crawl_runs").update({
  completed_at:new Date().toISOString(),
  status:"completed",
  requested_count:reviewed,
  success_count:evidenceRejected,
  failure_count:0,
  notes:[
    `Wikipedia relationships reviewed=${reviewed}`,
    `Wikipedia evidence rejected=${evidenceRejected}`,
    `Wikipedia-only relationship rows rejected=${relationshipsRejected}`,
    ...details.slice(0,50)
  ].join(" | ")
}).eq("id",run.id);

console.log("Wikipedia 50-year evidence cleanup complete.");
console.log(`Reviewed: ${reviewed}`);
console.log(`Wikipedia evidence rejected: ${evidenceRejected}`);
console.log(`Wikipedia-only relationships rejected: ${relationshipsRejected}`);
for(const d of details) console.log(`  ${d}`);
