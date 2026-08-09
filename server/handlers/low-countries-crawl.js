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
  const rx=new RegExp(`(${alt})\\s*\\.{0,40}\\s*([^\\[\\(]{1,180}?)(?:\\s*\\([^\\]]*?\\))?\\s*\\[(5\\d{8})\\]`,"gi");
  const out=[];const seen=new Set();
  for(const m of section.matchAll(rx)){
    const type=m[1].toLowerCase().replace(/\s+/g," ").trim(),relatedId=m[3];
    const label=m[2].replace(/\.+/g," ").replace(/\s+/g," ").trim();
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
    s.from("network_seed_queue").select("seed_name,ulan_id,geography_bucket,status,notes").eq("network_id","low_countries").order("seed_name"),
    s.from("low_countries_candidates").select("ulan_id,preferred_name,discovered_label,seed_connection_count,relationship_score,strongest_relationship,review_status").order("relationship_score",{ascending:false}).limit(500),
    s.from("low_countries_candidate_edges").select("*",{count:"exact",head:true})
  ]);
  if(sErr)throw sErr;if(cErr)throw cErr;if(eErr)throw eErr;
  const {data:edges,error:edgeRowsErr}=await s.from("low_countries_candidate_edges")
    .select("seed_ulan_id,candidate_ulan_id,candidate_label,relationship_type,visual_class,directed")
    .order("id",{ascending:true}).limit(5000);
  if(edgeRowsErr)throw edgeRowsErr;
  return {seeds:seeds||[],candidates:candidates||[],edge_count:edgeCount||0,edges:edges||[]};
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
      await s.from("network_seed_queue").update({
        status:"resolved",ulan_id:match.id,
        notes:`ULAN resolved: ${resolvedName}; name similarity ${similarity.toFixed(2)}`
      }).eq("network_id","low_countries").eq("seed_name",seedName);
      return res.status(200).json({status:"resolved",seed_name:seedName,ulan_id:match.id,matched_name:ident.preferred||match.name});
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
        await refreshCandidateStats(s,String(rel.relatedId));
        inserted++;
      }
      await s.from("network_seed_queue").update({status:"crawled",notes:`ULAN one-hop crawl: ${rels.length} relationship statements staged`}).eq("network_id","low_countries").eq("seed_name",seedName);
      return res.status(200).json({status:"crawled",seed_name:seedName,ulan_id:seed.ulan_id,relationships_found:rels.length,candidates_touched:inserted});
    }

    if(action==="enrich-candidate"){
      const ulanId=String(req.body?.ulan_id||"").trim();
      if(!/^5\d{8}$/.test(ulanId))return res.status(400).json({error:"Valid ULAN candidate ID required"});
      const text=decodeHtml(await (await request(PAGE(ulanId))).text());
      const ident=parseIdentity(text),years=deriveYears(text);
      const nationality=extractField(text,"Nationalities",["Roles","Gender","Related People or Corporate Bodies"]);
      const roles=extractField(text,"Roles",["Gender","Related People or Corporate Bodies","Biographies"]);
      const person=!ident.recordType||/^person$/i.test(ident.recordType);
      const context=lowCountriesContext(text);
      let review_status="candidate";
      if(!person||!context)review_status="held";
      const {error:uErr}=await s.from("low_countries_candidates").update({
        preferred_name:ident.preferred||null,record_type:ident.recordType||null,birth_year:years.birth_year,death_year:years.death_year,
        nationality_text:nationality||null,role_text:roles||null,review_status,updated_at:new Date().toISOString()
      }).eq("ulan_id",ulanId);
      if(uErr)throw uErr;
      if(review_status!=="held")await refreshCandidateStats(s,ulanId);
      return res.status(200).json({status:review_status,ulan_id:ulanId,preferred_name:ident.preferred||null,nationality,roles});
    }

    return res.status(400).json({error:"Unknown low-countries crawl mode"});
  }catch(e){
    return res.status(500).json({error:e.message||String(e)});
  }
};

module.exports._test={norm,parseRelationships,normalizeRelationship,relationWeight,lowCountriesContext,parseIdentity};
