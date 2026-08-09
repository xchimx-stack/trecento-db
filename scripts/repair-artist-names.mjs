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

const JOB_SOURCE="Getty ULAN preferred-name canonicalization v1";

const {data:done,error:doneErr}=await supabase
  .from("crawl_runs")
  .select("id")
  .eq("source",JOB_SOURCE)
  .eq("status","completed")
  .limit(1);
if(doneErr) throw doneErr;

if(done?.length){
  console.log("ULAN preferred-name canonicalization: already completed; skipping.");
  process.exit(0);
}

const {data:run,error:runErr}=await supabase
  .from("crawl_runs")
  .insert({source:JOB_SOURCE,status:"running"})
  .select("id")
  .single();
if(runErr) throw runErr;

function saneName(s){
  s=String(s||"").trim();
  if(!s || s.length>90) return false;
  if(/\b(active|probably|believed?|documented|workshop|pupil|apprentice|teacher|same artist|few scholars|plague|approximately|century|died|born|flourished|was the|was probably)\b/i.test(s)) return false;
  if(/\b\d{3,4}\s*[-–—]\s*\d{3,4}\b/.test(s)) return false;
  if(/,\s*(active|born|died|fl\.?|ca\.?|circa)\b/i.test(s)) return false;
  return true;
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
    .replace(/\s+/g," ")
    .trim();
}

function parseUlanNames(text){
  let preferred=null;
  const aliases=[];

  const start=text.indexOf("Names:");
  if(start<0) return {preferred,aliases};

  let section=text.slice(start);
  const stop=section.search(/Nationalities:|Roles:|Gender:|Related People or Corporate Bodies:/i);
  if(stop>0) section=section.slice(0,stop);

  // After HTML normalization, entries look like:
  // Cenni di Francesco di ser Cenni (preferred,U,display)
  const rx=/([A-ZÀ-ÖØ-öø-ÿ][^()]{1,180}?)\s*\(([^)]*)\)/g;

  for(const m of section.matchAll(rx)){
    const name=m[1]
      .replace(/^Names:\s*/i,"")
      .replace(/\.+/g," ")
      .replace(/\s+/g," ")
      .trim();
    const flags=String(m[2]||"").toLowerCase();

    if(!saneName(name)) continue;

    if(flags.includes("preferred") && !preferred){
      preferred=name;
    }else if(!aliases.includes(name)){
      aliases.push(name);
    }
  }

  if(preferred){
    const i=aliases.indexOf(preferred);
    if(i>=0) aliases.splice(i,1);
  }

  return {preferred,aliases};
}

const {data:artists,error:aErr}=await supabase
  .from("artists")
  .select("id,canonical_name,ulan_id")
  .not("ulan_id","is",null);
if(aErr) throw aErr;

let repaired=0;
let unchanged=0;
let failed=0;
let aliasRowsInserted=0;
const details=[];

for(let i=0;i<artists.length;i++){
  const a=artists[i];

  try{
    const endpoint=`https://www.getty.edu/vow/ULANFullDisplay?find=&nation=&role=&subjectid=${a.ulan_id}`;
    const r=await fetch(endpoint,{
      headers:{"User-Agent":"TrecentoNetwork ULAN preferred-name canonicalization"}
    });
    if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);

    const text=decodeHtml(await r.text());
    const {preferred,aliases}=parseUlanNames(text);

    if(!preferred) throw new Error("No explicit preferred ULAN name found");

    if(preferred!==a.canonical_name){
      const {error:uErr}=await supabase
        .from("artists")
        .update({canonical_name:preferred})
        .eq("id",a.id);
      if(uErr) throw uErr;
      repaired++;
      details.push(`${a.canonical_name} -> ${preferred}`);
    }else{
      unchanged++;
    }

    const aliasRows=aliases
      .filter(x=>x!==preferred)
      .map(alias=>({
        artist_id:a.id,
        alias,
        language:null,
        source:"Getty ULAN"
      }));

    for(const row of aliasRows){
      const {error:aliasErr}=await supabase
        .from("artist_aliases")
        .upsert(row,{onConflict:"artist_id,alias"});
      if(aliasErr) throw aliasErr;
      aliasRowsInserted++;
    }

  }catch(e){
    failed++;
    details.push(`FAILED ${a.canonical_name}: ${e.message}`);
  }

  // Be polite to Getty; this is a one-time normalization pass.
  if(i%8===7) await new Promise(r=>setTimeout(r,120));
}

await supabase.from("crawl_runs").update({
  completed_at:new Date().toISOString(),
  status:"completed",
  requested_count:artists.length,
  success_count:artists.length-failed,
  failure_count:failed,
  notes:[
    `canonical changes=${repaired}`,
    `unchanged=${unchanged}`,
    `aliases processed=${aliasRowsInserted}`,
    `failed=${failed}`,
    ...details.slice(0,30)
  ].join(" | ")
}).eq("id",run.id);

console.log(`ULAN preferred-name canonicalization complete.`);
console.log(`Artists checked: ${artists.length}`);
console.log(`Canonical names changed: ${repaired}`);
console.log(`Canonical names unchanged: ${unchanged}`);
console.log(`Alias rows processed: ${aliasRowsInserted}`);
console.log(`Failures: ${failed}`);
for(const d of details) console.log(`  ${d}`);
