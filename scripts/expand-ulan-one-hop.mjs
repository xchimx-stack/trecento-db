import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY=process.env.SUPABASE_SECRET_KEY;
if(!SUPABASE_URL||!SUPABASE_SECRET_KEY){
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY");
  process.exit(1);
}

const TARGET_TOTAL=300;
const JOB_SOURCE="Getty ULAN controlled one-hop expansion v1";
const PAGE=id=>`https://www.getty.edu/vow/ULANFullDisplay?find=&nation=&role=&subjectid=${id}`;

const supabase=createClient(SUPABASE_URL,SUPABASE_SECRET_KEY,{
  auth:{persistSession:false,autoRefreshToken:false}
});

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function fetchText(url,attempt=0){
  const r=await fetch(url,{
    headers:{
      "Accept":"text/html,application/xhtml+xml",
      "User-Agent":"TrecentoNetwork/1.0 controlled ULAN expansion"
    }
  });
  if((r.status===429||r.status===503) && attempt<4){
    const retry=Number(r.headers.get("retry-after")||0);
    await sleep(Math.max(retry*1000,1000*Math.pow(2,attempt)));
    return fetchText(url,attempt+1);
  }
  if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.text();
}

function decodeHtml(s){
  return String(s||"")
    .replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]+>/g," ")
    .replace(/&nbsp;|&#160;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/&ndash;|&#8211;/gi,"–")
    .replace(/&mdash;|&#8212;/gi,"—")
    .replace(/\s+/g," ")
    .trim();
}

function saneName(s){
  s=String(s||"").trim();
  if(!s||s.length>90) return false;
  if(/\b(active|probably|believed?|documented|workshop|pupil|apprentice|teacher|same artist|few scholars|plague|approximately|century|died|born|flourished|was the|was probably)\b/i.test(s)) return false;
  return true;
}

function identity(text){
  const recordType=(text.match(/Record Type:\s*([A-Za-z ]+?)\s+(?=[^\n]{1,180}?\()/i)?.[1]||"").trim();
  let preferred=null;
  const aliases=[];
  const start=text.indexOf("Names:");
  if(start>=0){
    let section=text.slice(start);
    const stop=section.search(/Nationalities:|Roles:|Gender:|Related People or Corporate Bodies:/i);
    if(stop>0) section=section.slice(0,stop);
    const rx=/([A-ZÀ-ÖØ-öø-ÿ][^()]{1,180}?)\s*\(([^)]*)\)/g;
    for(const m of section.matchAll(rx)){
      const name=m[1].replace(/^Names:\s*/i,"").replace(/\.+/g," ").replace(/\s+/g," ").trim();
      const flags=String(m[2]||"").toLowerCase();
      if(!saneName(name)) continue;
      if(flags.includes("preferred")&&!preferred) preferred=name;
      else if(name!==preferred&&!aliases.includes(name)) aliases.push(name);
    }
  }
  return {recordType,preferred,aliases};
}

function deriveRegion(text){
  const t=text.toLowerCase();
  if(/\bvenetian\b|\bvenice\b|\bpadua\b|\bpaduan\b|\bpadova\b/.test(t)) return "Veneto";
  if(/\bflorentine\b|\bflorence\b/.test(t)) return "Florence";
  if(/\bsienese\b|\bsiena\b/.test(t)) return "Siena";
  if(/\bbolognese\b|\bbologna\b/.test(t)) return "Bologna";
  if(/\brimini\b|\briminese\b/.test(t)) return "Rimini";
  if(/\bpisa\b|\bpisan\b/.test(t)) return "Pisa";
  if(/\brome\b|\broman\b/.test(t)) return "Rome";
  if(/\bnaples\b|\bneapolitan\b/.test(t)) return "Naples";
  return "Unclassified Italy";
}

function deriveYear(text){
  const idx=text.indexOf("Record Type:");
  const section=idx>=0?text.slice(idx,idx+1800):text.slice(0,1800);
  const years=[...section.matchAll(/\b(12\d{2}|13\d{2}|14\d{2})\b/g)].map(m=>Number(m[1]));
  if(years.length>=2 && Math.abs(years[1]-years[0])<=180) return Math.round((years[0]+years[1])/2);
  if(years.length) return years[0];
  return null;
}

function relevantItalianArtist(text,recordType,year,region){
  if(!/^person$/i.test(recordType||"")) return false;
  if(year!==null && (year<1200||year>1500)) return false;
  if(region!=="Unclassified Italy") return true;
  return /\bitalian\b|\bitaly\b|\btuscany\b|\btuscan\b|\bflorentine\b|\bsienese\b|\bvenetian\b|\bbolognese\b|\brimini\b|\bpisa\b|\bpadua\b|\brome\b|\bnaples\b/i.test(text);
}

const REL_TYPES=[
  "student of","teacher of","apprentice of","apprentice was",
  "master of","master was","employee of","employee was","member of",
  "worked with","partner of","collaborated with","associate of","associated with",
  "influenced by","influenced","grandchild of","grandparent of",
  "child of","parent of","sibling of","brother of","sister of"
];

function normalizeRelationship(type,currentId,relatedId){
  type=String(type||"").toLowerCase().trim();
  let from=currentId,to=relatedId,visual="dotted",directed=false;

  if(["student of","apprentice of","master was"].includes(type)){
    from=relatedId;to=currentId;visual="solid";directed=true;
  }else if(["teacher of","apprentice was","master of"].includes(type)){
    visual="solid";directed=true;
  }else if(type==="employee of"){
    from=relatedId;to=currentId;visual="solid";directed=true;
  }else if(type==="employee was"){
    visual="solid";directed=true;
  }else if(type==="influenced by"){
    from=relatedId;to=currentId;visual="dashed";directed=true;
  }else if(type==="influenced"){
    visual="dashed";directed=true;
  }else if(/worked with|partner of|collaborated with|associate of|associated with/.test(type)){
    visual="dashed";directed=false;
  }else if(type==="child of"||type==="grandchild of"){
    from=relatedId;to=currentId;visual="dotted";directed=true;
  }else if(type==="parent of"||type==="grandparent of"){
    visual="dotted";directed=true;
  }else{
    visual="dotted";directed=false;
  }
  return {from,to,visual,directed,relationship_type:type};
}

function parseRelationships(text,currentId){
  const start=text.indexOf("Related People or Corporate Bodies:");
  if(start<0) return [];
  let section=text.slice(start);
  const stop=section.search(/List\/Hierarchical Position:|Biographies:|Additional Names:|Sources and Contributors:/i);
  if(stop>0) section=section.slice(0,stop);

  const alt=REL_TYPES.slice().sort((a,b)=>b.length-a.length)
    .map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|");
  const rx=new RegExp(`(${alt})\\s*\\.{0,40}\\s*([^\\[\\(]{1,180}?)(?:\\s*\\([^\\]]*?\\))?\\s*\\[(5\\d{8})\\]`,"gi");
  const out=[];
  const seen=new Set();

  for(const m of section.matchAll(rx)){
    const type=m[1].toLowerCase().replace(/\s+/g," ").trim();
    const relatedId=m[3];
    const label=m[2].replace(/\.+/g," ").replace(/\s+/g," ").trim();
    const rel=normalizeRelationship(type,currentId,relatedId);
    const key=[rel.from,rel.to,rel.relationship_type].join("|");
    if(seen.has(key)) continue;
    seen.add(key);
    out.push({...rel,relatedId,label});
  }
  return out;
}

const {data:done,error:doneErr}=await supabase
  .from("crawl_runs")
  .select("id")
  .eq("source",JOB_SOURCE)
  .eq("status","completed")
  .limit(1);
if(doneErr) throw doneErr;
if(done?.length){
  console.log("Controlled ULAN expansion already completed; skipping.");
  process.exit(0);
}

const {data:existing,error:artistErr}=await supabase
  .from("artists")
  .select("id,canonical_name,ulan_id")
  .not("ulan_id","is",null);
if(artistErr) throw artistErr;

if((existing||[]).length>=TARGET_TOTAL){
  console.log(`Artist count already ${existing.length}; target ${TARGET_TOTAL} reached.`);
  process.exit(0);
}

const {data:run,error:runErr}=await supabase
  .from("crawl_runs")
  .insert({source:JOB_SOURCE,status:"running",requested_count:existing.length})
  .select("id").single();
if(runErr) throw runErr;

const existingByUlan=new Map(existing.map(a=>[String(a.ulan_id),a]));
const discovery=new Map();
const seedRelations=[];

console.log(`ULAN expansion: scanning ${existing.length} current artists for one-hop neighbors.`);

// Phase A: scan current artist relationship pages, politely and sequentially.
for(let i=0;i<existing.length;i++){
  const artist=existing[i];
  try{
    const text=decodeHtml(await fetchText(PAGE(artist.ulan_id)));
    const rels=parseRelationships(text,String(artist.ulan_id));
    for(const rel of rels){
      seedRelations.push(rel);
      if(!existingByUlan.has(rel.relatedId) && !discovery.has(rel.relatedId)){
        discovery.set(rel.relatedId,{
          ulan_id:rel.relatedId,
          discovered_from_artist_id:artist.id,
          discovered_from_ulan:String(artist.ulan_id),
          discovered_label:rel.label
        });
      }
    }
  }catch(e){
    console.log(`Seed scan failed ${artist.canonical_name}: ${e.message}`);
  }
  await sleep(300);
}

console.log(`One-hop ULAN candidates discovered: ${discovery.size}`);

const room=Math.max(0,TARGET_TOTAL-existing.length);
const candidates=[...discovery.values()].slice(0,room);
const accepted=[];

// Phase B: validate candidates as Trecento/early Quattrocento Italian persons.
for(let i=0;i<candidates.length;i++){
  const c=candidates[i];
  try{
    const text=decodeHtml(await fetchText(PAGE(c.ulan_id)));
    const id=identity(text);
    const year=deriveYear(text);
    const region=deriveRegion(text);

    if(!id.preferred || !relevantItalianArtist(text,id.recordType,year,region)){
      await sleep(300);
      continue;
    }

    accepted.push({
      candidate:c,
      preferred:id.preferred,
      aliases:id.aliases,
      year,
      region,
      recordType:id.recordType
    });
  }catch(e){
    console.log(`Candidate ${c.ulan_id} failed: ${e.message}`);
  }
  await sleep(300);

  if(existing.length+accepted.length>=TARGET_TOTAL) break;
}

console.log(`Accepted new ULAN artists: ${accepted.length}`);

const insertedByUlan=new Map();

for(const a of accepted){
  const entity_type=/\bmaster of\b|\bmaestro\b/i.test(a.preferred)?"anonymous_master":"person";
  const row={
    canonical_name:a.preferred,
    entity_type,
    ulan_id:String(a.candidate.ulan_id),
    layout_year:a.year,
    region:a.region==="Unclassified Italy"?null:a.region,
    region_confidence:a.region==="Unclassified Italy"?null:0.70,
    chronology_confidence:a.year?0.65:null,
    visibility_score:0,
    default_visible:false,
    review_status:"accepted",
    crawl_depth:1,
    discovered_from_artist_id:a.candidate.discovered_from_artist_id,
    discovery_source:"ULAN"
  };

  const {data:ins,error:insErr}=await supabase
    .from("artists")
    .upsert(row,{onConflict:"ulan_id"})
    .select("id,ulan_id,canonical_name")
    .single();
  if(insErr) throw insErr;
  insertedByUlan.set(String(ins.ulan_id),ins);

  if(a.aliases.length){
    const aliasRows=[...new Set(a.aliases)]
      .filter(x=>x&&x!==a.preferred)
      .map(alias=>({artist_id:ins.id,alias,language:null,source:"Getty ULAN"}));
    if(aliasRows.length){
      const {error:aliasErr}=await supabase
        .from("artist_aliases")
        .upsert(aliasRows,{onConflict:"artist_id,alias"});
      if(aliasErr) throw aliasErr;
    }
  }
}

// Refresh map after inserts.
const {data:allArtists,error:allErr}=await supabase
  .from("artists").select("id,ulan_id").not("ulan_id","is",null);
if(allErr) throw allErr;
const byUlan=new Map(allArtists.map(a=>[String(a.ulan_id),a]));

// Existing relation signatures, so we never duplicate graph edges.
const {data:existingRels,error:relErr}=await supabase
  .from("relationships")
  .select("id,from_artist_id,to_artist_id,relationship_type,visual_class,directed");
if(relErr) throw relErr;

function relKey(r){
  return [
    r.from_artist_id,r.to_artist_id,
    String(r.relationship_type||"").toLowerCase(),
    r.visual_class,Boolean(r.directed)
  ].join("|");
}
const existingRelKeys=new Set((existingRels||[]).map(relKey));
let insertedRelationships=0;

// Insert any seed->neighbor ULAN relation whose endpoints are now both in DB.
for(const rel of seedRelations){
  const from=byUlan.get(String(rel.from));
  const to=byUlan.get(String(rel.to));
  if(!from||!to||from.id===to.id) continue;

  const row={
    from_artist_id:from.id,
    to_artist_id:to.id,
    relationship_type:rel.relationship_type,
    visual_class:rel.visual,
    directed:rel.directed,
    confidence:0.90,
    review_status:"accepted"
  };
  const key=relKey(row);

  let relationshipId=null;

  if(!existingRelKeys.has(key)){
    const {data:inserted,error:iErr}=await supabase
      .from("relationships").insert(row).select("id").single();
    if(iErr) throw iErr;
    relationshipId=inserted.id;
    existingRelKeys.add(key);
    insertedRelationships++;
  }else{
    const existing=(existingRels||[]).find(r=>relKey(r)===key);
    relationshipId=existing?.id||null;
  }

  if(relationshipId){
    const {error:eErr}=await supabase
      .from("relationship_evidence")
      .upsert({
        relationship_id:relationshipId,
        source:"ULAN",
        source_url:PAGE(rel.from),
        evidence_text:`ULAN relationship: ${rel.relationship_type}`,
        confidence:1.0,
        review_status:"accepted"
      },{onConflict:"relationship_id,source,source_url"});
    if(eErr) throw eErr;
  }
}

const finalCount=existing.length+accepted.length;

await supabase.from("crawl_runs").update({
  completed_at:new Date().toISOString(),
  status:"completed",
  success_count:accepted.length,
  failure_count:Math.max(0,candidates.length-accepted.length),
  notes:`One-hop candidates=${discovery.size}; accepted=${accepted.length}; relationships inserted=${insertedRelationships}; final artist count≈${finalCount}; hard target=${TARGET_TOTAL}.`
}).eq("id",run.id);

console.log(`Controlled ULAN expansion complete.`);
console.log(`Existing artists: ${existing.length}`);
console.log(`New artists accepted: ${accepted.length}`);
console.log(`ULAN relationships inserted: ${insertedRelationships}`);
console.log(`Approximate final artist count: ${finalCount}`);
