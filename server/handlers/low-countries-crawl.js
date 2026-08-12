const {createClient}=require("@supabase/supabase-js");

const RECONCILE="https://services.getty.edu/vocab/reconcile/";
const PAGE=id=>`https://www.getty.edu/vow/ULANFullDisplay?find=&nation=&role=&subjectid=${id}`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function db(){
  const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!u||!k) throw new Error("Supabase admin configuration missing");
  return createClient(u,k,{auth:{persistSession:false,autoRefreshToken:false}});
}
function authorized(req){
  return Boolean(process.env.WIKI_CRAWL_TOKEN)&&String(req.headers["x-crawl-token"]||"")===process.env.WIKI_CRAWL_TOKEN;
}
async function request(url,options={},attempt=0){
  const r=await fetch(url,{...options,headers:{
    "User-Agent":"TrecentoNetwork/0.18.1 hidden Low Countries ULAN crawl",
    ...(options.headers||{})
  }});
  if((r.status===429||r.status===503)&&attempt<4){
    const retry=Number(r.headers.get("retry-after")||0);
    await sleep(Math.max(retry*1000,800*Math.pow(2,attempt)));
    return request(url,options,attempt+1);
  }
  if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r;
}
function decodeHtml(s){
  return String(s||"")
    .replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]+>/g," ")
    .replace(/&nbsp;|&#160;/gi," ")
    .replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
    .replace(/&ndash;|&#8211;/gi,"–").replace(/&mdash;|&#8212;/gi,"—")
    .replace(/\s+/g," ").trim();
}
function norm(s){
  return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/\b(the|van|de|der|den|von|di|of)\b/g," ")
    .replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}
function nameSimilarity(a,b){
  const A=new Set(norm(a).split(" ").filter(Boolean));
  const B=new Set(norm(b).split(" ").filter(Boolean));
  if(!A.size||!B.size) return 0;
  let hit=0;
  for(const x of A) if(B.has(x)) hit++;
  return (2*hit)/(A.size+B.size);
}
function saneName(s){
  s=String(s||"").trim();
  if(!s||s.length>110) return false;
  if(/\b(active|probably|believed?|documented|workshop|pupil|apprentice|teacher|same artist|century|died|born|flourished)\b/i.test(s)) return false;
  return true;
}
function parseIdentity(text){
  const recordType=(text.match(/Record Type:\s*([A-Za-z ]+?)(?=\s+[A-Z][^:]{0,40}:|\s+\()/i)?.[1]||"").trim();
  let preferred=null;const aliases=[];
  const start=text.indexOf("Names:");
  if(start>=0){
    let section=text.slice(start);
    const stop=section.search(/Nationalities:|Roles:|Gender:|Related People or Corporate Bodies:/i);
    if(stop>0)section=section.slice(0,stop);
    const rx=/([A-ZÀ-ÖØ-öø-ÿ][^()]{1,180}?)\s*\(([^)]*)\)/g;
    for(const m of section.matchAll(rx)){
      const name=m[1].replace(/^Names:\s*/i,"").replace(/\.+/g," ").replace(/\s+/g," ").trim();
      const flags=String(m[2]||"").toLowerCase();
      if(!saneName(name))continue;
      if(flags.includes("preferred")&&!preferred)preferred=name;
      if(!aliases.includes(name))aliases.push(name);
    }
  }
  return {recordType,preferred,aliases};
}
function extractField(text,label,nextLabels){
  const i=text.search(new RegExp(`${label}:`,"i"));if(i<0)return "";
  let s=text.slice(i+label.length+1);
  let end=s.length;
  for(const n of nextLabels){
    const j=s.search(new RegExp(`${n}:`,"i"));if(j>=0&&j<end)end=j;
  }
  return s.slice(0,end).trim().slice(0,1000);
}
function deriveYears(text){
  const bio=extractField(text,"Biographies",["Sources and Contributors","Additional Names","Events"]);
  const section=bio||text.slice(0,2500);
  const years=[...section.matchAll(/\b(15\d{2}|16\d{2}|17\d{2})\b/g)].map(m=>Number(m[1]));
  const uniq=[...new Set(years)];
  return {birth_year:uniq[0]||null,death_year:uniq[1]||null};
}
function deriveGeography(text){
  const t=String(text||"").toLowerCase();
  const rules=[
    ["Antwerp",/\bantwerp\b|\bantwerpen\b/],
    ["Brussels",/\bbrussels\b|\bbruxelles\b|\bbrussel\b/],
    ["Ghent",/\bghent\b|\bgent\b/],
    ["Bruges",/\bbruges\b|\bbrugge\b/],
    ["Mechelen",/\bmechelen\b|\bmalines\b/],
    ["Amsterdam",/\bamsterdam\b/],
    ["Haarlem",/\bhaarlem\b/],
    ["Leiden",/\bleiden\b|\bleyden\b/],
    ["Delft",/\bdelft\b/],
    ["The Hague",/\bthe hague\b|\bden haag\b|\bs-gravenhage\b/],
    ["Dordrecht",/\bdordrecht\b|\bdort\b/],
    ["Rotterdam",/\brotterdam\b/],
    ["Utrecht",/\butrecht\b/],
    ["Deventer",/\bdeventer\b/],
    ["Middelburg",/\bmiddelburg\b/],
    ["Zeeland",/\bzeeland\b/]
  ];
  for(const [name,rx] of rules) if(rx.test(t)) return name;
  if(/\bflemish\b|\bflanders\b/.test(t)) return "Flanders";
  if(/\bdutch\b|\bholland\b|\bnetherlands\b/.test(t)) return "Holland";
  return null;
}

function deriveUlanPlaces(text){
  const birthDeath=extractField(text,"Birth and Death Places",["Events","Related People or Corporate Bodies","List/Hierarchical Position","Biographies"]);
  const birth=(birthDeath.match(/\bBorn:\s*(.*?)(?=\s+Died:|$)/i)?.[1]||"").trim();
  const death=(birthDeath.match(/\bDied:\s*(.*)$/i)?.[1]||"").trim();
  const events=extractField(text,"Events",["Related People or Corporate Bodies","List/Hierarchical Position","Biographies"]);
  const active=[];
  const rx=/\bactive:\s*(.*?)(?=\s+(?:active|lived|worked|resided|born|died):|$)/gi;
  for(const m of events.matchAll(rx)){
    const v=String(m[1]||"").trim();
    if(v && !active.includes(v)) active.push(v);
  }
  const precise=v=>{
    const g=deriveGeography(v);
    return g && !["Flanders","Holland"].includes(g) ? g : null;
  };
  const activeSpecificPlace=active.find(v=>precise(v)) || null;
  const activePlace=activeSpecificPlace || active[0] || null;
  const activeSpecificGeo=activeSpecificPlace ? deriveGeography(activeSpecificPlace) : null;
  const activeBroadGeo=activePlace ? deriveGeography(activePlace) : null;
  const deathGeo=death ? deriveGeography(death) : null;
  const birthGeo=birth ? deriveGeography(birth) : null;
  let geography_bucket=null,geography_source=null;
  if(activeSpecificGeo){geography_bucket=activeSpecificGeo;geography_source="ULAN active location"}
  else if(deathGeo){geography_bucket=deathGeo;geography_source="ULAN death place fallback"}
  else if(birthGeo){geography_bucket=birthGeo;geography_source="ULAN birth place fallback"}
  else if(activeBroadGeo){geography_bucket=activeBroadGeo;geography_source="ULAN active region"}
  return {birth_place:birth||null,death_place:death||null,active_place:activePlace,active_places:active,geography_bucket,geography_source};
}

function usableGeoBucket(v){
  const s=String(v||"").trim();
  return s && !/^unknown$/i.test(s) ? s : null;
}

function lowCountriesContext(text){
  return /\b(dutch|flemish|netherlandish|netherlands|holland|antwerp|amsterdam|haarlem|delft|leiden|utrecht|dordrecht|the hague|deventer|brussels|bruges|ghent|mechelen)\b/i.test(String(text||""));
}

const REL_TYPES=[
 "student of","teacher of","apprentice of","apprentice was","master of","master was",
 "employee of","employee was","worked with","partner of","collaborated with","associate of","associated with",
 "influenced by","influenced","grandchild of","grandparent of","child of","parent of",
 "sibling of","brother of","sister of"
];
function normalizeRelationship(type,currentId,relatedId){
  type=String(type||"").toLowerCase().trim();
  let from=currentId,to=relatedId,visual="dotted",directed=false;
  if(["student of","apprentice of","master was"].includes(type)){from=relatedId;to=currentId;visual="solid";directed=true}
  else if(["teacher of","apprentice was","master of"].includes(type)){visual="solid";directed=true}
  else if(type==="employee of"){from=relatedId;to=currentId;visual="solid";directed=true}
  else if(type==="employee was"){visual="solid";directed=true}
  else if(type==="influenced by"){from=relatedId;to=currentId;visual="dashed";directed=true}
  else if(type==="influenced"){visual="dashed";directed=true}
  else if(/worked with|partner of|collaborated with|associate of|associated with/.test(type)){visual="dashed";directed=false}
  else if(type==="child of"||type==="grandchild of"){from=relatedId;to=currentId;visual="dotted";directed=true}
  else if(type==="parent of"||type==="grandparent of"){visual="dotted";directed=true}
  return {from,to,visual_class:visual,directed,relationship_type:type};
}
function parseRelationships(text,currentId){
  const start=text.indexOf("Related People or Corporate Bodies:");if(start<0)return [];
  let section=text.slice(start);
  const stop=section.search(/List\/Hierarchical Position:|Biographies:|Additional Names:|Sources and Contributors:/i);
  if(stop>0)section=section.slice(0,stop);
  const alt=REL_TYPES.slice().sort((a,b)=>b.length-a.length).map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|");

  // Getty's rendered ULAN text uses dotted leaders twice: once after the
  // relationship label and often again between the related person's name and
  // the biography in parentheses.  The old parser assumed the name ran
  // directly into the parenthetical and silently dropped legitimate rows.
  // Capture everything up to the ULAN id, then strip the dotted biography
  // leader during label cleanup instead of encoding page typography in the
  // matching expression.
  const rx=new RegExp(`(${alt})\\s*\\.{0,80}\\s*([\\s\\S]{1,420}?)\\s*\\[(5\\d{8})\\]`,`gi`);
  const out=[];const seen=new Set();
  for(const m of section.matchAll(rx)){
    const type=m[1].toLowerCase().replace(/\s+/g," ").trim(),relatedId=m[3];
    let label=String(m[2]||"")
      .replace(/\s*\.{2,}\s*\([^)]*\)\s*$/," ")
      .replace(/\s+\([^)]*\)\s*$/," ")
      .replace(/\.{2,}/g," ")
      .replace(/\s+/g," ").trim();
    if(!saneName(label))continue;
    const rel=normalizeRelationship(type,currentId,relatedId);
    const key=[rel.from,rel.to,rel.relationship_type].join("|");
    if(seen.has(key))continue;seen.add(key);out.push({...rel,relatedId,label});
  }
  return out;
}
function relationWeight(type){
  type=String(type||"").toLowerCase();
  if(/student|teacher|apprentice|master/.test(type))return 12;
  if(/worked with|partner|collaborated|employee/.test(type))return 10;
  if(/influenced/.test(type))return 7;
  if(/child|parent|sibling|brother|sister|grand/.test(type))return 5;
  if(/associate/.test(type))return 4;
  return 2;
}
async function reconcileExact(name){
  const body=new URLSearchParams();
  body.set("queries",JSON.stringify({q0:{query:name,type:"/ulan"}}));
  const r=await request(RECONCILE,{method:"POST",headers:{"Accept":"application/json","Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},body});
  const data=await r.json();
  const rows=(data?.q0?.result||[]).map(x=>({id:String(x.id||"").split("/").pop(),name:x.name||"",score:Number(x.score)||0,match:Boolean(x.match)}))
    .filter(x=>/^5\d{8}$/.test(x.id));
  const exact=rows.filter(x=>norm(x.name)===norm(name)).sort((a,b)=>(b.match-a.match)||(b.score-a.score))[0];
  if(exact)return exact;
  return rows.sort((a,b)=>(b.match-a.match)||(b.score-a.score))[0]||null;
}
async function refreshCandidateStats(s,ulanId){
  const {data:edges,error}=await s.from("low_countries_candidate_edges").select("seed_ulan_id,relationship_type").eq("candidate_ulan_id",ulanId);
  if(error)throw error;
  const seeds=new Set((edges||[]).map(x=>x.seed_ulan_id));
  let score=0,strongest=null,strongestWeight=-1;
  for(const e of edges||[]){
    const w=relationWeight(e.relationship_type);score+=w;
    if(w>strongestWeight){strongestWeight=w;strongest=e.relationship_type}
  }
  const review_status=seeds.size>=3&&score>=24?"core_ready":seeds.size>=2&&score>=12?"expanded_ready":"candidate";
  const {error:uErr}=await s.from("low_countries_candidates").update({
    seed_connection_count:seeds.size,relationship_score:score,strongest_relationship:strongest,review_status,updated_at:new Date().toISOString()
  }).eq("ulan_id",ulanId);
  if(uErr)throw uErr;
}
async function status(s){
  const [{data:seeds,error:sErr},{data:candidates,error:cErr},{count:edgeCount,error:eErr}]=await Promise.all([
    s.from("network_seed_queue").select("seed_name,ulan_id,geography_bucket,geography_source,status,notes,birth_year,death_year,preferred_name,birth_place,death_place,active_place").eq("network_id","low_countries").order("seed_name"),
    s.from("low_countries_candidates").select("ulan_id,preferred_name,discovered_label,seed_connection_count,relationship_score,strongest_relationship,review_status,crawl_depth,birth_year,death_year,geography_bucket,geography_source,birth_place,death_place,active_place,nationality_text,role_text").order("relationship_score",{ascending:false}).limit(500),
    s.from("low_countries_candidate_edges").select("*",{count:"exact",head:true})
  ]);
  if(sErr)throw sErr;if(cErr)throw cErr;if(eErr)throw eErr;
  const {data:edges,error:edgeRowsErr}=await s.from("low_countries_network_edges")
    .select("from_ulan_id,to_ulan_id,relationship_type,visual_class,directed,source_depth")
    .order("id",{ascending:true}).limit(12000);
  if(edgeRowsErr)throw edgeRowsErr;
  return {seeds:seeds||[],candidates:candidates||[],edge_count:(edges||[]).length,edges:edges||[],targets:{core:100,expanded:300}};
}

module.exports=async function(req,res){
  if(!authorized(req))return res.status(401).json({error:"Invalid admin token"});
  const action=String(req.query?.mode||"status");
  const s=db();
  try{
    if(action==="status")return res.status(200).json(await status(s));

    if(req.method!=="POST")return res.status(405).json({error:"POST required"});

    if(action==="resolve-seed"){
      const seedName=String(req.body?.seed_name||"").trim();
      if(!seedName)return res.status(400).json({error:"seed_name required"});
      const {data:seed,error:seedErr}=await s.from("network_seed_queue").select("*").eq("network_id","low_countries").eq("seed_name",seedName).maybeSingle();
      if(seedErr)throw seedErr;if(!seed)return res.status(404).json({error:"Unknown seed"});
      const match=await reconcileExact(seedName);
      if(!match){
        await s.from("network_seed_queue").update({status:"failed",notes:"No ULAN reconciliation result"}).eq("network_id","low_countries").eq("seed_name",seedName);
        return res.status(200).json({status:"failed",seed_name:seedName});
      }
      const page=decodeHtml(await (await request(PAGE(match.id))).text());
      const ident=parseIdentity(page);
      const resolvedName=ident.preferred||match.name||"";
      const similarity=Math.max(nameSimilarity(resolvedName,seedName),nameSimilarity(match.name,seedName));
      const goodName=similarity>=0.72 || Boolean(match.match && match.score>=80);
      const person=!ident.recordType||/^person$/i.test(ident.recordType);
      // These seeds are manually curated. Geographic context must not veto a
      // strong ULAN person/name match; geography is checked during enrichment.
      if(!goodName||!person){
        await s.from("network_seed_queue").update({
          status:"held",ulan_id:match.id,
          notes:`Needs review: ${resolvedName}; ${ident.recordType||"unknown record type"}; name similarity ${similarity.toFixed(2)}`
        }).eq("network_id","low_countries").eq("seed_name",seedName);
        return res.status(200).json({status:"held",seed_name:seedName,ulan_id:match.id,matched_name:resolvedName,name_similarity:similarity});
      }
      const years=deriveYears(page),places=deriveUlanPlaces(page);
      await s.from("network_seed_queue").update({
        status:"resolved",ulan_id:match.id,preferred_name:resolvedName||null,
        birth_year:years.birth_year,death_year:years.death_year,
        birth_place:places.birth_place,death_place:places.death_place,active_place:places.active_place,
        geography_source:usableGeoBucket(seed.geography_bucket)?"curated seed location":places.geography_source,
        geography_bucket:usableGeoBucket(seed.geography_bucket)||places.geography_bucket||null,
        notes:`ULAN resolved: ${resolvedName}; name similarity ${similarity.toFixed(2)}`
      }).eq("network_id","low_countries").eq("seed_name",seedName);
      return res.status(200).json({status:"resolved",seed_name:seedName,ulan_id:match.id,matched_name:ident.preferred||match.name});
    }

    if(action==="enrich-seed"){
      const seedName=String(req.body?.seed_name||"").trim();
      const {data:seed,error:seedErr}=await s.from("network_seed_queue").select("*").eq("network_id","low_countries").eq("seed_name",seedName).maybeSingle();
      if(seedErr)throw seedErr;if(!seed?.ulan_id)return res.status(400).json({error:"Seed must already have a ULAN ID"});
      const text=decodeHtml(await (await request(PAGE(seed.ulan_id))).text());
      const years=deriveYears(text),places=deriveUlanPlaces(text);
      const {error:uErr}=await s.from("network_seed_queue").update({
        birth_year:seed.birth_year||years.birth_year,death_year:seed.death_year||years.death_year,
        birth_place:places.birth_place,death_place:places.death_place,active_place:places.active_place,
        geography_bucket:usableGeoBucket(seed.geography_bucket)||places.geography_bucket||null,
        geography_source:usableGeoBucket(seed.geography_bucket)?"curated seed location":places.geography_source,
        notes:`${seed.notes||""}${seed.notes?" · ":""}ULAN places refreshed`
      }).eq("network_id","low_countries").eq("seed_name",seedName);
      if(uErr)throw uErr;
      return res.status(200).json({status:"enriched",seed_name:seedName,ulan_id:seed.ulan_id,places});
    }

    if(action==="refresh-places-seed"){
      const seedName=String(req.body?.seed_name||"").trim();
      const {data:seed,error:seedErr}=await s.from("network_seed_queue").select("*").eq("network_id","low_countries").eq("seed_name",seedName).maybeSingle();
      if(seedErr)throw seedErr;if(!seed?.ulan_id)return res.status(400).json({error:"Seed must already have a ULAN ID"});
      const text=decodeHtml(await (await request(PAGE(seed.ulan_id))).text());
      const places=deriveUlanPlaces(text),years=deriveYears(text);
      const existingGeo=usableGeoBucket(seed.geography_bucket);
      const {error:uErr}=await s.from("network_seed_queue").update({
        birth_year:seed.birth_year||years.birth_year,death_year:seed.death_year||years.death_year,
        birth_place:places.birth_place||seed.birth_place||null,death_place:places.death_place||seed.death_place||null,active_place:places.active_place||seed.active_place||null,
        geography_bucket:existingGeo||places.geography_bucket||null,
        geography_source:existingGeo?(seed.geography_source||"curated seed location"):(places.geography_source||seed.geography_source||null),
        notes:`${seed.notes||""}${seed.notes?" · ":""}ULAN place-only refresh`
      }).eq("network_id","low_countries").eq("seed_name",seedName);
      if(uErr)throw uErr;
      return res.status(200).json({status:"enriched",seed_name:seedName,ulan_id:seed.ulan_id,places});
    }

    if(action==="refresh-places-candidate"){
      const ulanId=String(req.body?.ulan_id||"").trim();
      if(!/^5\d{8}$/.test(ulanId))return res.status(400).json({error:"Valid ULAN candidate ID required"});
      const {data:row,error:rowErr}=await s.from("low_countries_candidates").select("*").eq("ulan_id",ulanId).maybeSingle();
      if(rowErr)throw rowErr;if(!row)return res.status(404).json({error:"Candidate not found"});
      const text=decodeHtml(await (await request(PAGE(ulanId))).text());
      const places=deriveUlanPlaces(text),years=deriveYears(text);
      const existingGeo=usableGeoBucket(row.geography_bucket);
      const {error:uErr}=await s.from("low_countries_candidates").update({
        birth_year:row.birth_year||years.birth_year,death_year:row.death_year||years.death_year,
        birth_place:places.birth_place||row.birth_place||null,death_place:places.death_place||row.death_place||null,active_place:places.active_place||row.active_place||null,
        geography_bucket:existingGeo||places.geography_bucket||null,
        geography_source:existingGeo?(row.geography_source||"existing mapped geography"):(places.geography_source||row.geography_source||null),
        updated_at:new Date().toISOString()
      }).eq("ulan_id",ulanId);
      if(uErr)throw uErr;
      return res.status(200).json({status:"enriched",ulan_id:ulanId,places});
    }

    if(action==="crawl-seed"){
      const seedName=String(req.body?.seed_name||"").trim();
      const {data:seed,error:seedErr}=await s.from("network_seed_queue").select("*").eq("network_id","low_countries").eq("seed_name",seedName).maybeSingle();
      if(seedErr)throw seedErr;if(!seed?.ulan_id)return res.status(400).json({error:"Seed must be resolved first"});
      const text=decodeHtml(await (await request(PAGE(seed.ulan_id))).text());
      const rels=parseRelationships(text,String(seed.ulan_id));
      let inserted=0;
      for(const rel of rels){
        // Never stage the seed itself as its own candidate.
        if(String(rel.relatedId)===String(seed.ulan_id))continue;
        const candidate={ulan_id:String(rel.relatedId),discovered_label:rel.label||null,updated_at:new Date().toISOString()};
        const {error:cErr}=await s.from("low_countries_candidates").upsert(candidate,{onConflict:"ulan_id",ignoreDuplicates:false});
        if(cErr)throw cErr;
        const edge={
          seed_ulan_id:String(seed.ulan_id),candidate_ulan_id:String(rel.relatedId),candidate_label:rel.label||null,
          relationship_type:rel.relationship_type,visual_class:rel.visual_class,directed:rel.directed,
          source_url:PAGE(seed.ulan_id)
        };
        const {error:eErr}=await s.from("low_countries_candidate_edges").upsert(edge,{onConflict:"seed_ulan_id,candidate_ulan_id,relationship_type",ignoreDuplicates:true});
        if(eErr)throw eErr;
        const {error:gErr}=await s.from("low_countries_network_edges").upsert({
          from_ulan_id:String(rel.from),to_ulan_id:String(rel.to),relationship_type:rel.relationship_type,
          visual_class:rel.visual_class,directed:rel.directed,source_url:PAGE(seed.ulan_id),source_depth:0
        },{onConflict:"from_ulan_id,to_ulan_id,relationship_type",ignoreDuplicates:true});
        if(gErr)throw gErr;
        await refreshCandidateStats(s,String(rel.relatedId));
        inserted++;
      }
      const nextStatus=seed.status==="held"?"held":"crawled";
      await s.from("network_seed_queue").update({status:nextStatus,notes:`ULAN one-hop crawl: ${rels.length} relationship statements staged`}).eq("network_id","low_countries").eq("seed_name",seedName);
      return res.status(200).json({status:nextStatus,seed_name:seedName,ulan_id:seed.ulan_id,relationships_found:rels.length,candidates_touched:inserted});
    }


    if(action==="crawl-candidate"){
      const ulanId=String(req.body?.ulan_id||"").trim();
      if(!/^5\d{8}$/.test(ulanId))return res.status(400).json({error:"Valid first-degree ULAN ID required"});
      const {data:source,error:srcErr}=await s.from("low_countries_candidates")
        .select("ulan_id,preferred_name,discovered_label,crawl_depth,review_status")
        .eq("ulan_id",ulanId).maybeSingle();
      if(srcErr)throw srcErr;
      if(!source||Number(source.crawl_depth)!==1)return res.status(400).json({error:"Second-degree crawl source must be an existing depth-1 candidate"});
      if(source.review_status==="held"||source.review_status==="rejected")return res.status(400).json({error:"Held/rejected candidates are not crawl sources"});

      const [{count:candidateCount,error:countErr},{count:seedCount,error:seedCountErr}]=await Promise.all([
        s.from("low_countries_candidates").select("*",{count:"exact",head:true}),
        s.from("network_seed_queue").select("*",{count:"exact",head:true}).eq("network_id","low_countries")
      ]);
      if(countErr)throw countErr;if(seedCountErr)throw seedCountErr;
      // The 300-record ceiling limits discovery of NEW depth-2 candidate nodes only.
      // It must never prevent relationship statements from being parsed/stored for
      // artists already in the network. Text/edge enrichment is intentionally
      // independent of the media-storage safety budget.
      let remaining=Math.max(0,300-(candidateCount||0)-(seedCount||0));

      const text=decodeHtml(await (await request(PAGE(ulanId))).text());
      const rels=parseRelationships(text,ulanId);
      let touched=0;
      for(const rel of rels){
        if(String(rel.relatedId)===ulanId)continue;

        // Never overwrite an existing depth-1 record with depth 2.
        const {data:existing}=await s.from("low_countries_candidates")
          .select("ulan_id,crawl_depth").eq("ulan_id",String(rel.relatedId)).maybeSingle();
        if(!existing){
          if(remaining<=0)continue;
          const {error:cErr}=await s.from("low_countries_candidates").insert({
            ulan_id:String(rel.relatedId),discovered_label:rel.label||null,crawl_depth:2,
            review_status:"candidate",updated_at:new Date().toISOString()
          });
          if(cErr)throw cErr;
          remaining--;
        }

        const {error:eErr}=await s.from("low_countries_network_edges").upsert({
          from_ulan_id:String(rel.from),to_ulan_id:String(rel.to),relationship_type:rel.relationship_type,
          visual_class:rel.visual_class,directed:rel.directed,source_url:PAGE(ulanId),source_depth:1
        },{onConflict:"from_ulan_id,to_ulan_id,relationship_type",ignoreDuplicates:true});
        if(eErr)throw eErr;
        touched++;
      }
      return res.status(200).json({
        status:"crawled",ulan_id:ulanId,source_depth:1,relationships_found:rels.length,candidates_touched:touched
      });
    }

    if(action==="enrich-candidate"){
      const ulanId=String(req.body?.ulan_id||"").trim();
      if(!/^5\d{8}$/.test(ulanId))return res.status(400).json({error:"Valid ULAN candidate ID required"});
      const text=decodeHtml(await (await request(PAGE(ulanId))).text());
      const ident=parseIdentity(text),years=deriveYears(text),places=deriveUlanPlaces(text);
      const nationality=extractField(text,"Nationalities",["Roles","Gender","Birth and Death Places","Events","Related People or Corporate Bodies"]);
      const roles=extractField(text,"Roles",["Gender","Birth and Death Places","Events","Related People or Corporate Bodies","Biographies"]);
      const geography=places.geography_bucket;
      const person=!ident.recordType||/^person$/i.test(ident.recordType);
      const context=lowCountriesContext(text);
      let review_status="candidate";
      if(!person||!context)review_status="held";
      const {error:uErr}=await s.from("low_countries_candidates").update({
        preferred_name:ident.preferred||null,record_type:ident.recordType||null,birth_year:years.birth_year,death_year:years.death_year,
        birth_place:places.birth_place,death_place:places.death_place,active_place:places.active_place,
        geography_bucket:geography||null,geography_source:places.geography_source||null,
        nationality_text:nationality||null,role_text:roles||null,review_status,updated_at:new Date().toISOString()
      }).eq("ulan_id",ulanId);
      if(uErr)throw uErr;
      if(review_status!=="held")await refreshCandidateStats(s,ulanId);
      return res.status(200).json({status:review_status,ulan_id:ulanId,preferred_name:ident.preferred||null,nationality,roles,places});
    }

    return res.status(400).json({error:"Unknown low-countries crawl mode"});
  }catch(e){
    return res.status(500).json({error:e.message||String(e)});
  }
};

module.exports._test={norm,parseRelationships,normalizeRelationship,relationWeight,lowCountriesContext,deriveGeography,deriveUlanPlaces,parseIdentity,nameSimilarity};
