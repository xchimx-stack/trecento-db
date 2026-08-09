import { createClient } from "@supabase/supabase-js";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY;
if(!url||!secret){
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY");
  process.exit(1);
}

const supabase=createClient(url,secret,{
  auth:{persistSession:false,autoRefreshToken:false}
});

const JOB_SOURCE="Wikipedia chronology cleanup v1";

const {data:done,error:doneErr}=await supabase
  .from("crawl_runs")
  .select("id")
  .eq("source",JOB_SOURCE)
  .eq("status","completed")
  .limit(1);
if(doneErr) throw doneErr;

if(done?.length){
  console.log("Wikipedia chronology cleanup already completed; skipping.");
  process.exit(0);
}

const {data:run,error:runErr}=await supabase
  .from("crawl_runs")
  .insert({source:JOB_SOURCE,status:"running"})
  .select("id").single();
if(runErr) throw runErr;

const [
  {data:artists,error:aErr},
  {data:relationships,error:rErr},
  {data:evidence,error:eErr}
]=await Promise.all([
  supabase.from("artists")
    .select("id,canonical_name,layout_year,birth_year,death_year,floruit_start,floruit_end"),
  supabase.from("relationships")
    .select("id,from_artist_id,to_artist_id,relationship_type,visual_class,directed,review_status"),
  supabase.from("relationship_evidence")
    .select("id,relationship_id,source,source_url,evidence_text,review_status")
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

function artistYear(a){
  const vals=[
    a?.layout_year,
    a?.floruit_start,
    a?.birth_year,
    a?.floruit_end,
    a?.death_year
  ].filter(Number.isFinite);
  return vals.length?vals[0]:null;
}

function chronologyCheck(type,fromArtist,toArtist){
  const fy=artistYear(fromArtist);
  const ty=artistYear(toArtist);

  if(!Number.isFinite(fy)||!Number.isFinite(ty)){
    return {ok:true,reason:null,difference:null};
  }

  const diff=ty-fy;
  type=String(type||"").toLowerCase();

  if(["pupil of","student of","workshop of","teacher of","master of"].includes(type)){
    if(diff < -10) return {ok:false,reason:"pupil predates teacher",difference:diff};
    if(diff > 50) return {ok:false,reason:"teacher/pupil gap exceeds 50 years",difference:diff};
  }

  if(["collaborated with","worked with"].includes(type)){
    if(Math.abs(diff)>50){
      return {ok:false,reason:"collaboration gap exceeds 50 years",difference:diff};
    }
  }

  return {ok:true,reason:null,difference:diff};
}

let reviewed=0;
let rejected=0;
const details=[];

for(const r of relationships||[]){
  const ev=evByRel.get(r.id)||[];
  const hasWiki=ev.some(e=>e.source==="Wikipedia");
  const hasUlan=ev.some(e=>e.source==="ULAN");

  // Only auto-reject Wikipedia-only candidate edges.
  // Never suppress a ULAN-backed relationship due to approximate chronology.
  if(!hasWiki || hasUlan) continue;
  if(r.review_status!=="candidate") continue;

  reviewed++;

  const from=byArtist.get(r.from_artist_id);
  const to=byArtist.get(r.to_artist_id);
  if(!from||!to) continue;

  const check=chronologyCheck(r.relationship_type,from,to);
  if(check.ok) continue;

  const {error:updateErr}=await supabase
    .from("relationships")
    .update({review_status:"rejected_chronology"})
    .eq("id",r.id);
  if(updateErr) throw updateErr;

  // Keep evidence, but mark Wikipedia evidence rejected as well.
  const wikiEvidence=ev.filter(e=>e.source==="Wikipedia");
  for(const e of wikiEvidence){
    const {error:evUpdateErr}=await supabase
      .from("relationship_evidence")
      .update({review_status:"rejected_chronology"})
      .eq("id",e.id);
    if(evUpdateErr) throw evUpdateErr;
  }

  rejected++;
  details.push(
    `${from.canonical_name} -> ${to.canonical_name}: ${r.relationship_type}; `+
    `${check.reason}; diff=${check.difference}`
  );
}

await supabase.from("crawl_runs").update({
  completed_at:new Date().toISOString(),
  status:"completed",
  requested_count:reviewed,
  success_count:rejected,
  failure_count:0,
  notes:[
    `Wikipedia-only candidate edges reviewed=${reviewed}`,
    `rejected by chronology=${rejected}`,
    ...details.slice(0,40)
  ].join(" | ")
}).eq("id",run.id);

console.log("Wikipedia chronology cleanup complete.");
console.log(`Wikipedia-only candidates reviewed: ${reviewed}`);
console.log(`Rejected by chronology: ${rejected}`);
for(const d of details) console.log(`  ${d}`);
