import fs from "node:fs/promises";

const SEEDS = new URL("../data/seed-artists.json", import.meta.url);
const OUT = new URL("../data/imported-artists.json", import.meta.url);
const STATUS = new URL("../data/crawl-status.json", import.meta.url);
const RECONCILE = "https://services.getty.edu/vocab/reconcile/";
const ULAN_PAGE = id => `https://www.getty.edu/vow/ULANFullDisplay?find=&nation=&role=&subjectid=${id}`;
const ULAN_SEMANTIC_PAGE = id => `http://vocab.getty.edu/page/ulan/${id}`;

const BATCH_SIZE = 10;
const PAGE_CONCURRENCY = 5;
const EXPANSION_CAP = 50;

const REL_PRIORITY = {
  "documented_training": 1,
  "workshop_employment": 1,
  "workshop_membership": 1,
  "family_parent_child": 2,
  "family_sibling": 2,
  "direct_influence": 3,
  "collaboration": 3,
  "association": 4,
  "family_or_association": 4
};

const REGIONAL_ANCHORS = [
  {seed_name:"Giotto di Bondone", region:"Florence"},
  {seed_name:"Duccio di Buoninsegna", region:"Siena"},
  {seed_name:"Pietro Cavallini", region:"Rome"},
  {seed_name:"Paolo Veneziano", region:"Veneto"},
  {seed_name:"Vitale da Bologna", region:"Bologna"},
  {seed_name:"Giovanni da Rimini", region:"Rimini"}
];

const run = {
  run_id:`ulan-materialize-${Date.now()}`,
  source:"Getty ULAN",
  started_at:new Date().toISOString(),
  completed_at:null,
  duration_ms:null,
  requested_seed_count:0,
  matched_seed_count:0,
  detail_pages_requested:0,
  detail_pages_ok:0,
  request_count:0,
  retries:0,
  throttles_429:0,
  service_503:0,
  other_http_errors:0,
  fatal_error:null,
  region_counts:{},
  relationship_count:0,
  notes:[
    "ULAN reconciliation plus ULAN record-page enrichment.",
    "Node chronology/region are derived from ULAN display data for layout testing.",
    "Only explicit teacher/student/workshop-like ULAN relations create edges."
  ]
};

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function request(url, options={}, attempt=0){
  run.request_count++;
  const r=await fetch(url,{
    ...options,
    headers:{
      "User-Agent":"TrecentoNetwork/0.5.2 materialization proof-of-concept",
      ...(options.headers||{})
    }
  });
  if(r.status===429 || r.status===503){
    if(r.status===429) run.throttles_429++;
    if(r.status===503) run.service_503++;
    if(attempt>=5) throw new Error(`${r.status} ${r.statusText} after retries`);
    run.retries++;
    const ra=Number(r.headers.get("retry-after"));
    const delay=Number.isFinite(ra)&&ra>0 ? ra*1000 : Math.min(20000,800*(2**attempt));
    await sleep(delay);
    return request(url,options,attempt+1);
  }
  if(!r.ok){
    run.other_http_errors++;
    throw new Error(`${r.status} ${r.statusText}`);
  }
  return r;
}

function chunk(a,n){const o=[];for(let i=0;i<a.length;i+=n)o.push(a.slice(i,i+n));return o;}

async function reconcile(names){
  const result=new Map();
  for(const batch of chunk(names,BATCH_SIZE)){
    const queries={};
    batch.forEach((name,i)=>queries[`q${i}`]={query:name,type:"/ulan"});
    const body=new URLSearchParams();
    body.set("queries",JSON.stringify(queries));
    const r=await request(RECONCILE,{
      method:"POST",
      headers:{
        "Accept":"application/json",
        "Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"
      },
      body
    });
    const j=await r.json();
    batch.forEach((name,i)=>{
      const candidates=(j?.[`q${i}`]?.result||[]).map(x=>({
        id:String(x.id||"").split("/").pop()||null,
        name:x.name||null,
        score:typeof x.score==="number"?x.score:null,
        match:Boolean(x.match)
      }));
      result.set(name,candidates);
    });
    await sleep(250);
  }
  return result;
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

function deriveRegion(text){
  const t=text.toLowerCase();
  if(/\bvenetian\b|\bvenice\b/.test(t)) return "Veneto";
  if(/\bflorentine\b|\bflorence\b/.test(t)) return "Florence";
  if(/\bsienese\b|\bsiena\b/.test(t)) return "Siena";
  if(/\bbolognese\b|\bbologna\b/.test(t)) return "Bologna";
  if(/\brimini\b|\briminese\b/.test(t)) return "Rimini";
  if(/\bpadua\b|\bpaduan\b|\bpadova\b/.test(t)) return "Veneto";
  if(/\brome\b|\broman\b/.test(t)) return "Rome";
  if(/\bnaples\b|\bneapolitan\b/.test(t)) return "Naples";
  return "Unclassified Italy";
}

function deriveYear(text){
  // Use the early record/biography text only so source/publication dates do not contaminate chronology.
  const recordIdx=text.indexOf("Record Type:");
  let section=recordIdx>=0 ? text.slice(recordIdx,recordIdx+1600) : text.slice(0,1600);

  // Handle "active 1341-1347", "1266-1337", "ca. 1300-after 1360", etc.
  const years=[...section.matchAll(/\b(12\d{2}|13\d{2}|14\d{2})\b/g)].map(m=>Number(m[1]));
  if(years.length>=2){
    const a=years[0], b=years[1];
    if(Math.abs(b-a)<=180) return Math.round((a+b)/2);
  }
  if(years.length===1) return years[0];
  return 1350;
}

function extractSummary(text){
  const m=text.match(/Record Type:\s*(?:Person|Corporate Body)\s+(.{1,260}?)(?:\s+Note:|\s+Names:)/i);
  return m ? m[1].trim() : null;
}




function relationFromLabel(type,currentId,relatedId,relatedLabel){
  type=String(type||"").toLowerCase().replace(/\s+/g," ").trim();

  let from=currentId, to=relatedId;
  let style="dotted", meaning="general influence", directed=false;
  let evidence_class="association";

  if(type==="student of" || type==="apprentice of" || type==="master was"){
    from=relatedId; to=currentId;
    style="solid"; directed=true;
    meaning="pupil / workshop"; evidence_class="documented_training";
  }else if(type==="teacher of" || type==="apprentice was" || type==="master of"){
    from=currentId; to=relatedId;
    style="solid"; directed=true;
    meaning="pupil / workshop"; evidence_class="documented_training";
  }else if(type==="employee of"){
    from=relatedId; to=currentId;
    style="solid"; directed=true;
    meaning="pupil / workshop"; evidence_class="workshop_employment";
  }else if(type==="employee was"){
    from=currentId; to=relatedId;
    style="solid"; directed=true;
    meaning="pupil / workshop"; evidence_class="workshop_employment";
  }else if(type.includes("member of")){
    style="solid"; directed=false;
    meaning="pupil / workshop"; evidence_class="workshop_membership";
  }else if(type==="influenced by"){
    from=relatedId; to=currentId;
    style="dashed"; directed=true;
    meaning="collaborator / direct influence"; evidence_class="direct_influence";
  }else if(type==="influenced"){
    from=currentId; to=relatedId;
    style="dashed"; directed=true;
    meaning="collaborator / direct influence"; evidence_class="direct_influence";
  }else if(
    type.includes("worked with") || type.includes("partner of") ||
    type.includes("collaborated with") || type.includes("associate of") ||
    type.includes("associated with")
  ){
    style="dashed"; directed=false;
    meaning="collaborator / direct influence"; evidence_class="collaboration";
  }else if(type==="parent of"){
    from=currentId; to=relatedId;
    style="dotted"; directed=true;
    meaning="general influence"; evidence_class="family_parent_child";
  }else if(type==="child of"){
    from=relatedId; to=currentId;
    style="dotted"; directed=true;
    meaning="general influence"; evidence_class="family_parent_child";
  }else if(
    type.includes("sibling") || type.includes("brother") ||
    type.includes("sister")
  ){
    style="dotted"; directed=false;
    meaning="general influence"; evidence_class="family_sibling";
  }else{
    return null;
  }

  return {
    current_id:currentId,
    related_id:relatedId,
    related_label:relatedLabel||`ULAN ${relatedId}`,
    source_relation:type,
    from_ulan:from,
    to_ulan:to,
    style, meaning, directed, evidence_class
  };
}

function relationLabelFromPredicate(predicate){
  const p=String(predicate||"").toLowerCase();

  // Getty ULAN relationship codes documented by Getty:
  // 1101 person teacher of person
  // 1102 person student of person
  if(/1101/.test(p)) return "teacher of";
  if(/1102/.test(p)) return "student of";

  const tests=[
    ["teacher","teacher of"],["student","student of"],
    ["child","child of"],["parent","parent of"],
    ["sibling","sibling of"],["brother","brother of"],["sister","sister of"],
    ["employee","employee of"],["member","member of"],
    ["collabor","collaborated with"],["partner","partner of"],
    ["associate","associate of"],["influencedby","influenced by"],
    ["influenced_by","influenced by"],["influence","influenced"]
  ];
  for(const [needle,label] of tests){
    if(p.replace(/[^a-z0-9_]/g,"").includes(needle)) return label;
  }
  return null;
}

function ulanIdFromValue(v){
  if(typeof v==="string"){
    const m=v.match(/ulan\/(5\d{8})/i) || v.match(/\b(5\d{8})\b/);
    return m?.[1]||null;
  }
  if(v && typeof v==="object"){
    for(const k of ["id","@id","uri","value"]){
      const id=ulanIdFromValue(v[k]);
      if(id) return id;
    }
  }
  return null;
}

function labelFromValue(v){
  if(typeof v==="string" && !/ulan\/5\d{8}/i.test(v)) return v;
  if(v && typeof v==="object"){
    for(const k of ["label","prefLabel","name","@value","value"]){
      const x=v[k];
      if(typeof x==="string" && !/ulan\/5\d{8}/i.test(x)) return x;
      if(Array.isArray(x)){
        const s=x.find(y=>typeof y==="string");
        if(s) return s;
      }
    }
  }
  return null;
}

function extractStructuredRelationships(data,currentId){
  const found=[];
  const seen=new Set();

  function add(type,relatedId,label){
    if(!type || !relatedId || relatedId===currentId) return;
    const rel=relationFromLabel(type,currentId,relatedId,label);
    if(!rel) return;
    const key=[rel.source_relation,rel.related_id,rel.from_ulan,rel.to_ulan].join("|");
    if(seen.has(key)) return;
    seen.add(key); found.push(rel);
  }

  function walk(node,path=[]){
    if(node==null) return;
    if(Array.isArray(node)){
      for(const item of node) walk(item,path);
      return;
    }
    if(typeof node!=="object") return;

    for(const [key,val] of Object.entries(node)){
      const relLabel=relationLabelFromPredicate(key);

      if(relLabel){
        const vals=Array.isArray(val)?val:[val];
        for(const x of vals){
          const rid=ulanIdFromValue(x);
          if(rid) add(relLabel,rid,labelFromValue(x));
        }
      }

      // Reified relationship objects often carry a relation/type plus a target.
      if(val && typeof val==="object"){
        const obj=val;
        const candidateType=
          relationLabelFromPredicate(obj.type) ||
          relationLabelFromPredicate(obj["@type"]) ||
          relationLabelFromPredicate(obj.relation) ||
          relationLabelFromPredicate(obj.relationship) ||
          relationLabelFromPredicate(obj.rel_type) ||
          relationLabelFromPredicate(obj.predicate);

        const rid=
          ulanIdFromValue(obj.target) ||
          ulanIdFromValue(obj.related) ||
          ulanIdFromValue(obj.object) ||
          ulanIdFromValue(obj.agent) ||
          ulanIdFromValue(obj.person) ||
          ulanIdFromValue(obj["@id"]);

        if(candidateType && rid){
          add(candidateType,rid,
              labelFromValue(obj.target) ||
              labelFromValue(obj.related) ||
              labelFromValue(obj.object) ||
              labelFromValue(obj));
        }
      }

      walk(val,[...path,key]);
    }
  }

  walk(data);
  return found;
}


function extractHtmlRelationships(text,currentId){
  const out=[];
  const seen=new Set();

  const start=text.indexOf("Related People or Corporate Bodies:");
  if(start<0) return out;

  let section=text.slice(start);
  const stops=[
    "List/Hierarchical Position:",
    "Biographies:",
    "Additional Names:",
    "Sources and Contributors:"
  ];
  let stopAt=section.length;
  for(const s of stops){
    const i=section.indexOf(s);
    if(i>=0 && i<stopAt) stopAt=i;
  }
  section=section.slice(0,stopAt);

  // The full-record display normalizes to text like:
  // student of .... Cimabue .... (bio) [500016284]
  // teacher of .... Daddi, Bernardo .... (bio) [500004953]
  const relationTypes=[
    "student of","teacher of","apprentice of","apprentice was",
    "master of","master was",
    "employee of","employee was",
    "member of",
    "worked with","partner of","collaborated with","associate of","associated with",
    "influenced by","influenced",
    "child of","parent of","sibling of","brother of","sister of"
  ];

  const relAlt=relationTypes
    .sort((a,b)=>b.length-a.length)
    .map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"))
    .join("|");

  // Match one relation at a time and stop the label before a parenthetical biography.
  const rx=new RegExp(
    `(${relAlt})\\s*\\.{0,40}\\s*([^\\[\\(]{1,180}?)(?:\\s*\\([^\\]]*?\\))?\\s*\\[(5\\d{8})\\]`,
    "gi"
  );

  for(const m of section.matchAll(rx)){
    const type=m[1].toLowerCase().replace(/\s+/g," ").trim();
    const label=m[2]
      .replace(/\.+/g," ")
      .replace(/\s+/g," ")
      .trim();

    let normalized=type;
    if(type==="apprentice of") normalized="student of";
    if(type==="apprentice was") normalized="teacher of";
    if(type==="master of") normalized="teacher of";
    if(type==="master was") normalized="student of";

    const rel=relationFromLabel(normalized,currentId,m[3],label);
    if(!rel) continue;
    rel.source_relation=type;

    const key=[rel.source_relation,rel.related_id,rel.from_ulan,rel.to_ulan].join("|");
    if(seen.has(key)) continue;
    seen.add(key);
    out.push(rel);
  }

  return out;
}
function mergeRelations(primary,fallback){
  const out=[], seen=new Set();
  for(const rel of [...primary,...fallback]){
    const key=[rel.source_relation,rel.related_id,rel.from_ulan,rel.to_ulan].join("|");
    if(seen.has(key)) continue;
    seen.add(key); out.push(rel);
  }
  return out;
}




function extractRecordIdentity(text){
  // Getty Full Record text normalizes as:
  // Record Type: Person Giotto (Italian painter...)
  // Names: Giotto (preferred,...)
  const typeMatch=text.match(/Record Type:\s*([A-Za-z ]+?)\s+(?=[^\n]{1,180}?\()/i);
  const record_type=typeMatch?.[1]?.trim() || null;

  let preferred_name=null;
  const namesStart=text.indexOf("Names:");
  if(namesStart>=0){
    let names=text.slice(namesStart);
    const stop=names.search(/Nationalities:|Roles:|Gender:|Related People or Corporate Bodies:/i);
    if(stop>0) names=names.slice(0,stop);

    // Preferred/display name is the first name marked preferred.
    const pref=names.match(/Names:\s*(.+?)\s*\(preferred[^)]*\)/i);
    if(pref) preferred_name=pref[1].replace(/\.+/g," ").replace(/\s+/g," ").trim();
  }

  if(!preferred_name){
    const rec=text.match(/Record Type:\s*(?:Person|Corporate Body)\s+(.+?)\s*\(/i);
    if(rec) preferred_name=rec[1].replace(/\s+/g," ").trim();
  }

  return {record_type,preferred_name};
}

function saneArtistLabel(label){
  const s=String(label||"").trim();
  if(!s || s.length>90) return false;
  if(/\b(probably|believe|documented|workshop\s+\d|plague|same artist|few scholars|active in|was the|was probably)\b/i.test(s)) return false;
  return true;
}

async function enrichOne(base){
  if(!base.ulan.id) return base;
  run.detail_pages_requested++;

  try{
    const r=await request(ULAN_PAGE(base.ulan.id),{
      headers:{
        "Accept":"text/html,application/xhtml+xml"
      }
    });
    const html=await r.text();
    const text=decodeHtml(html);
    run.detail_pages_ok++;

    const identity=extractRecordIdentity(text);
    const relationships=extractHtmlRelationships(text,base.ulan.id);
    const region=deriveRegion(text);
    run.region_counts[region]=(run.region_counts[region]||0)+1;

    if(base.ulan.id==="500010766"){
      run.giotto_relationship_diagnostic={
        parsed_count:relationships.length,
        relationships:relationships.map(x=>({
          relation:x.source_relation,
          related_id:x.related_id,
          related_label:x.related_label,
          from_ulan:x.from_ulan,
          to_ulan:x.to_ulan,
          style:x.style,
          directed:x.directed
        }))
      };
    }

    return {
      ...base,
      canonical_name:saneArtistLabel(identity.preferred_name) ? identity.preferred_name : base.canonical_name,
      record_type:identity.record_type,
      ulan:{
        ...base.ulan,
        page_url:ULAN_PAGE(base.ulan.id),
        semantic_page_url:ULAN_SEMANTIC_PAGE(base.ulan.id),
        summary:extractSummary(text),
        relationship_source:"getty_full_record_display"
      },
      layout:{year:deriveYear(text),region},
      relationships,
      relationship_debug:{
        html_count:relationships.length,
        source:"getty_full_record_display"
      }
    };
  }catch(e){
    return {
      ...base,
      layout:{year:null,region:"Unclassified Italy"},
      relationships:[],
      relationship_debug:{
        html_count:0,
        source:"getty_full_record_display",
        html_error:e.message
      },
      detail_error:e.message
    };
  }
}
async function mapLimit(items,limit,fn){
  const results=new Array(items.length);
  let next=0;
  async function worker(){
    while(true){
      const i=next++;
      if(i>=items.length) return;
      results[i]=await fn(items[i],i);
      await sleep(120);
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));
  return results;
}



async function main(){
  const t0=Date.now();
  const seed=JSON.parse(await fs.readFile(SEEDS,"utf8"));
  const names=[...new Set([
    ...seed.artists.map(x=>x.seed_name),
    ...REGIONAL_ANCHORS.map(x=>x.seed_name)
  ])];
  run.requested_seed_count=names.length;

  const rec=await reconcile(names);
  let artists=names.map(name=>{
    const c=rec.get(name)||[];
    const best=c[0]||null;
    return {
      seed_name:name,
      canonical_name:best?.name||name,
      ulan:{
        id:best?.id||null,
        uri:best?.id?`http://vocab.getty.edu/ulan/${best.id}`:null,
        score:best?.score??null,
        exact_match:best?.match??false,
        candidates:c.slice(0,5)
      },
      anchor_region:REGIONAL_ANCHORS.find(x=>x.seed_name===name)?.region||null,
      review_status:best?"ulan_candidate":"ulan_unmatched"
    };
  });
  run.matched_seed_count=artists.filter(x=>x.ulan.id).length;

  artists=await mapLimit(artists,PAGE_CONCURRENCY,enrichOne);

  // Rank current records by internal relationship degree.
  const currentIds=new Set(artists.map(a=>a.ulan.id).filter(Boolean));
  const degree=new Map([...currentIds].map(id=>[id,0]));
  for(const a of artists){
    for(const rel of a.relationships||[]){
      if(currentIds.has(rel.related_id)){
        degree.set(a.ulan.id,(degree.get(a.ulan.id)||0)+1);
      }
    }
  }

  const anchorIds=new Set(
    artists.filter(a=>a.anchor_region && a.ulan.id).map(a=>a.ulan.id)
  );

  // Sources for expansion: anchors first, then highest-degree current artists.
  const sources=[...artists]
    .filter(a=>a.ulan.id)
    .sort((a,b)=>{
      const aa=anchorIds.has(a.ulan.id)?1:0;
      const ba=anchorIds.has(b.ulan.id)?1:0;
      if(aa!==ba) return ba-aa;
      return (degree.get(b.ulan.id)||0)-(degree.get(a.ulan.id)||0);
    });

  const knownIds=new Set(currentIds);
  const candidates=[];

  for(const a of sources){
    for(const rel of a.relationships||[]){
      if(!rel.related_id || knownIds.has(rel.related_id)) continue;
      candidates.push({
        related_id:rel.related_id,
        related_label:rel.related_label || `ULAN ${rel.related_id}`,
        discovered_from:a.ulan.id,
        source_is_anchor:anchorIds.has(a.ulan.id),
        source_degree:degree.get(a.ulan.id)||0,
        evidence_class:rel.evidence_class||"association",
        style:rel.style||"dotted",
        directed:Boolean(rel.directed)
      });
    }
  }

  // Deduplicate and rank.
  const bestById=new Map();
  for(const c of candidates){
    const existing=bestById.get(c.related_id);
    const rank=[
      REL_PRIORITY[c.evidence_class] ?? 9,
      c.source_is_anchor ? 0 : 1,
      -c.source_degree
    ];
    if(!existing){
      bestById.set(c.related_id,{...c,rank});
    }else{
      const er=existing.rank;
      const better = rank[0] < er[0] ||
        (rank[0]===er[0] && rank[1] < er[1]) ||
        (rank[0]===er[0] && rank[1]===er[1] && rank[2] < er[2]);
      if(better) bestById.set(c.related_id,{...c,rank});
    }
  }

  const selected=[...bestById.values()]
    .sort((a,b)=>
      a.rank[0]-b.rank[0] ||
      a.rank[1]-b.rank[1] ||
      a.rank[2]-b.rank[2] ||
      a.related_label.localeCompare(b.related_label)
    )
    .slice(0,EXPANSION_CAP);

  const discovered=selected.map(c=>({
    seed_name:c.related_label,
    canonical_name:c.related_label,
    ulan:{
      id:c.related_id,
      uri:`http://vocab.getty.edu/ulan/${c.related_id}`,
      score:null,
      exact_match:true,
      candidates:[]
    },
    discovered_from_anchor:c.source_is_anchor ? c.discovered_from : null,
    discovered_from:c.discovered_from,
    discovery_evidence_class:c.evidence_class,
    review_status:"ulan_related_candidate"
  }));

  const enrichedDiscovered=await mapLimit(discovered,PAGE_CONCURRENCY,enrichOne);
  const personDiscoveries=enrichedDiscovered.filter(a=>{
    const t=String(a.record_type||"").toLowerCase();
    if(t && t!=="person") return false;
    return saneArtistLabel(a.canonical_name);
  });
  artists.push(...personDiscoveries);

  // Build graph relationships across all retained records.
  const ids=new Set(artists.map(a=>a.ulan.id).filter(Boolean));
  const priority={solid:3,dashed:2,dotted:1};
  const byPair=new Map();

  for(const a of artists){
    for(const rel of a.relationships||[]){
      if(!ids.has(rel.related_id)) continue;

      const from=rel.from_ulan||a.ulan.id;
      const to=rel.to_ulan||rel.related_id;
      const pair=[from,to].sort().join("|");

      const evidence={
        from_ulan:from,
        to_ulan:to,
        style:rel.style,
        meaning:rel.meaning,
        directed:Boolean(rel.directed),
        source:"Getty ULAN",
        source_relation:rel.source_relation,
        evidence_class:rel.evidence_class
      };

      const existing=byPair.get(pair);
      if(!existing){
        byPair.set(pair,{...evidence,evidence:[evidence]});
      }else{
        existing.evidence.push(evidence);
        if((priority[rel.style]||0)>(priority[existing.style]||0)){
          existing.from_ulan=from;
          existing.to_ulan=to;
          existing.style=rel.style;
          existing.meaning=rel.meaning;
          existing.directed=Boolean(rel.directed);
          existing.source_relation=rel.source_relation;
          existing.evidence_class=rel.evidence_class;
        }else if(
          (priority[rel.style]||0)===(priority[existing.style]||0) &&
          rel.directed && !existing.directed
        ){
          existing.from_ulan=from;
          existing.to_ulan=to;
          existing.directed=true;
          existing.source_relation=rel.source_relation;
          existing.evidence_class=rel.evidence_class;
        }
      }
    }
  }

  const graphRelationships=[...byPair.values()];
  run.relationship_count=graphRelationships.length;
  run.expansion_cap=EXPANSION_CAP;
  run.discovered_count=personDiscoveries.length;
  run.total_artist_count=artists.length;
  run.records_with_relationships=artists.filter(a=>(a.relationships||[]).length>0).length;
  run.total_raw_relationships=artists.reduce((s,a)=>s+(a.relationships||[]).length,0);

  run.completed_at=new Date().toISOString();
  run.duration_ms=Date.now()-t0;

  await fs.writeFile(OUT,JSON.stringify({
    generated_at:run.completed_at,
    source:"Getty ULAN",
    count:artists.length,
    expansion_cap:EXPANSION_CAP,
    note:"Controlled ULAN expansion proof dataset.",
    artists,
    relationships:graphRelationships
  },null,2));

  await fs.writeFile(STATUS,JSON.stringify(run,null,2));

  console.log(`Controlled ULAN expansion: ${artists.length} total records, ${personDiscoveries.length} person records added.`);
  console.log(`Relationships: ${graphRelationships.length}; duration ${run.duration_ms}ms.`);
}
main().catch(async e=>{
  run.fatal_error=e.message;
  run.completed_at=new Date().toISOString();
  try{await fs.writeFile(STATUS,JSON.stringify(run,null,2));}catch{}
  console.error(e); process.exit(1);
});
