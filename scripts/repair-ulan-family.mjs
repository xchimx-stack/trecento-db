import { createClient } from "@supabase/supabase-js";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY;
if(!url||!secret){console.error("Missing Supabase environment variables");process.exit(1)}

const supabase=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const JOB_SOURCE="Getty ULAN family repair v1";

const {data:done,error:doneErr}=await supabase
  .from("crawl_runs")
  .select("id,status")
  .eq("source",JOB_SOURCE)
  .eq("status","completed")
  .limit(1);
if(doneErr) throw doneErr;
if(done?.length){
  console.log("ULAN family repair: already completed; skipping.");
  process.exit(0);
}

const {data:runRow,error:runErr}=await supabase
  .from("crawl_runs")
  .insert({source:JOB_SOURCE,status:"running"})
  .select("id")
  .single();
if(runErr) throw runErr;
const runId=runRow.id;

const {data:artists,error:aErr}=await supabase
  .from("artists")
  .select("id,canonical_name,ulan_id")
  .not("ulan_id","is",null);
if(aErr) throw aErr;

const {data:existing,error:rErr}=await supabase
  .from("relationships")
  .select("id,from_artist_id,to_artist_id,relationship_type,visual_class,directed");
if(rErr) throw rErr;

const byUlan=new Map(artists.map(a=>[String(a.ulan_id),a]));
const existingKeys=new Set(
  (existing||[]).map(r=>[
    r.from_artist_id,r.to_artist_id,
    String(r.relationship_type||"").toLowerCase(),
    r.visual_class,Boolean(r.directed)
  ].join("|"))
);

function decodeHtml(s){
  return String(s||"")
    .replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]+>/g," ")
    .replace(/&nbsp;|&#160;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/\s+/g," ")
    .trim();
}

function parseFamily(text,currentUlan){
  const start=text.indexOf("Related People or Corporate Bodies:");
  if(start<0) return [];
  let section=text.slice(start);
  const stop=section.search(/List\/Hierarchical Position:|Biographies:|Additional Names:|Sources and Contributors:/i);
  if(stop>0) section=section.slice(0,stop);

  const types=[
    "grandchild of","grandparent of",
    "child of","parent of",
    "sibling of","brother of","sister of"
  ];
  const alt=types.map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|");
  const rx=new RegExp(
    `(${alt})\\s*\\.{0,40}\\s*([^\\[\\(]{1,180}?)(?:\\s*\\([^\\]]*?\\))?\\s*\\[(5\\d{8})\\]`,
    "gi"
  );
  const out=[];
  for(const m of section.matchAll(rx)){
    const type=m[1].toLowerCase().replace(/\s+/g," ").trim();
    const related=m[3];
    let from=currentUlan,to=related,directed=true,evidence="family_parent_child";

    if(type==="child of"){from=related;to=currentUlan}
    else if(type==="parent of"){from=currentUlan;to=related}
    else if(type==="grandchild of"){from=related;to=currentUlan;evidence="family_grandparent"}
    else if(type==="grandparent of"){from=currentUlan;to=related;evidence="family_grandparent"}
    else {
      directed=false;
      evidence="family_sibling";
      from=currentUlan;to=related;
    }

    out.push({type,from,to,directed,evidence});
  }
  return out;
}

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const candidates=[];
let requests=0, failures=0;

for(let i=0;i<artists.length;i++){
  const a=artists[i];
  try{
    const endpoint=`https://www.getty.edu/vow/ULANFullDisplay?find=&nation=&role=&subjectid=${a.ulan_id}`;
    const r=await fetch(endpoint,{headers:{"User-Agent":"TrecentoNetwork family relationship repair"}});
    requests++;
    if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const text=decodeHtml(await r.text());
    for(const rel of parseFamily(text,String(a.ulan_id))) candidates.push(rel);
  }catch(e){
    failures++;
  }
  if(i%8===7) await sleep(120);
}

// Deduplicate reciprocal ULAN statements into one normalized edge.
const normalized=new Map();
for(const rel of candidates){
  const from=byUlan.get(String(rel.from));
  const to=byUlan.get(String(rel.to));
  if(!from||!to||from.id===to.id) continue;

  const relationshipType=rel.type;
  let key;
  if(rel.directed){
    key=[from.id,to.id,rel.evidence].join("|");
  }else{
    key=[...([from.id,to.id].sort()),rel.evidence].join("|");
  }

  const prior=normalized.get(key);
  // Prefer direct parent/child wording over grandparent wording where the same exact
  // normalized pair somehow surfaces more than once.
  if(!prior || (
    prior.relationship_type.includes("grand") &&
    !relationshipType.includes("grand")
  )){
    normalized.set(key,{
      from_artist_id:from.id,
      to_artist_id:to.id,
      relationship_type:relationshipType,
      visual_class:"dotted",
      directed:rel.directed,
      confidence:0.90,
      review_status:"imported_unreviewed",
      evidence_class:rel.evidence
    });
  }
}

const inserts=[];
for(const row of normalized.values()){
  const exactKey=[
    row.from_artist_id,row.to_artist_id,
    row.relationship_type,row.visual_class,Boolean(row.directed)
  ].join("|");

  // Also avoid inserting if the same directional pair already exists as a family edge,
  // even if earlier parser wording differs ("child of" vs "parent of").
  const sameFamilyPair=(existing||[]).some(r=>
    r.from_artist_id===row.from_artist_id &&
    r.to_artist_id===row.to_artist_id &&
    r.visual_class==="dotted" &&
    Boolean(r.directed)===Boolean(row.directed) &&
    /parent|child|grand|family|sibling|brother|sister/i.test(r.relationship_type||"")
  );

  if(!existingKeys.has(exactKey) && !sameFamilyPair) inserts.push(row);
}

let insertedRows=[];
if(inserts.length){
  const clean=inserts.map(({evidence_class,...r})=>r);
  const {data,error}=await supabase.from("relationships").insert(clean).select("id,from_artist_id,to_artist_id,relationship_type");
  if(error) throw error;
  insertedRows=data||[];

  const sources=insertedRows.map((r,i)=>({
    relationship_id:r.id,
    source_name:"Getty ULAN",
    source_type:"authority_record",
    source_relation:r.relationship_type,
    notes:`Family repair; evidence class ${inserts[i]?.evidence_class||"family"}`
  }));
  if(sources.length){
    const {error:sErr}=await supabase.from("relationship_sources").insert(sources);
    if(sErr) throw sErr;
  }
}

await supabase.from("crawl_runs").update({
  completed_at:new Date().toISOString(),
  status:"completed",
  requested_count:artists.length,
  success_count:artists.length-failures,
  failure_count:failures,
  notes:`Parsed ${candidates.length} family statements; inserted ${insertedRows.length} missing normalized family edges.`
}).eq("id",runId);

console.log(`ULAN family repair: ${artists.length} artists checked, ${candidates.length} statements parsed, ${insertedRows.length} edges inserted.`);
