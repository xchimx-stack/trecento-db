const { createClient } = require("@supabase/supabase-js");

const TARGET_TOTAL=250;
const WINDOW_START=1270;
const WINDOW_END=1420;

const ALLOWED_STYLES=new Set(["solid","dashed","dotted"]);
const ALLOWED_TYPES=new Set([
  "collaborated with","worked with","pupil of","student of","teacher of",
  "master of","workshop of","influenced by","influenced",
  "child of","parent of","brother of","sibling of","proposed identity"
]);

function overlapsWindow(start,end){
  if(!Number.isFinite(start)&&!Number.isFinite(end)) return false;
  if(!Number.isFinite(start)) start=end;
  if(!Number.isFinite(end)) end=start;
  if(start>end){const t=start;start=end;end=t}
  return end>=WINDOW_START && start<=WINDOW_END;
}

function validWikiUrl(value){
  try{
    const u=new URL(String(value||""));
    return u.protocol==="https:" &&
      (u.hostname==="it.wikipedia.org" || u.hostname==="en.wikipedia.org");
  }catch{return false}
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
    .replace(/\s+/g," ").trim();
}

async function fetchText(url,attempt=0){
  const r=await fetch(url,{
    headers:{
      "Accept":"text/html,application/xhtml+xml",
      "User-Agent":"TrecentoNetwork/1.0 identity resolution"
    }
  });
  if((r.status===429||r.status===503)&&attempt<3){
    await new Promise(resolve=>setTimeout(resolve,800*Math.pow(2,attempt)));
    return fetchText(url,attempt+1);
  }
  if(!r.ok) throw new Error(`ULAN ${r.status}`);
  return r.text();
}

function parseUlanIdentity(text,fallback){
  const plain=decodeHtml(text);
  let preferred=null;
  const namesStart=plain.indexOf("Names:");
  if(namesStart>=0){
    let section=plain.slice(namesStart);
    const stop=section.search(/Nationalities:|Roles:|Gender:|Related People or Corporate Bodies:/i);
    if(stop>0) section=section.slice(0,stop);
    const rx=/([A-ZÀ-ÖØ-öø-ÿ][^()]{1,180}?)\s*\(([^)]*)\)/g;
    for(const m of section.matchAll(rx)){
      const name=m[1].replace(/^Names:\s*/i,"").replace(/\.+/g," ").replace(/\s+/g," ").trim();
      const flags=String(m[2]||"").toLowerCase();
      if(flags.includes("preferred")&&name.length<100){preferred=name;break}
    }
  }
  const recordType=(plain.match(/Record Type:\s*([A-Za-z ]+?)(?=\s+[A-Z][^:]{0,40}:|\s+\()/i)?.[1]||"").trim();
  return {preferred:preferred||fallback,recordType,plain};
}

function deriveRegion(text){
  const t=String(text||"").toLowerCase();
  if(/\bvenetian\b|\bvenice\b|\bpadua\b|\bpaduan\b|\bpadova\b/.test(t)) return "Veneto";
  if(/\bflorentine\b|\bflorence\b|\bfirenze\b/.test(t)) return "Florence";
  if(/\bsienese\b|\bsiena\b/.test(t)) return "Siena";
  if(/\bbolognese\b|\bbologna\b/.test(t)) return "Bologna";
  if(/\brimini\b|\briminese\b/.test(t)) return "Rimini";
  if(/\bpisa\b|\bpisan\b/.test(t)) return "Pisa";
  if(/\brome\b|\broman\b|\broma\b/.test(t)) return "Rome";
  if(/\bnaples\b|\bneapolitan\b|\bnapoli\b/.test(t)) return "Naples";
  return null;
}

function normalizeRelation(rel,subjectId,targetId){
  const type=String(rel?.relationship_type||"").toLowerCase();
  let from=subjectId,to=targetId;
  const orientation=String(rel?.orientation||"subject_to_target");
  if(orientation==="target_to_subject"){from=targetId;to=subjectId}
  if(orientation==="peer" && String(from)>String(to)){const t=from;from=to;to=t}
  return {
    from_artist_id:from,
    to_artist_id:to,
    relationship_type:type,
    visual_class:String(rel?.visual_class||"dotted"),
    directed:Boolean(rel?.directed)
  };
}

function pairMatches(r,a,b,directed){
  if(directed) return r.from_artist_id===a && r.to_artist_id===b;
  return (r.from_artist_id===a&&r.to_artist_id===b)||(r.from_artist_id===b&&r.to_artist_id===a);
}

module.exports=async function handler(req,res){
  if(req.method!=="POST"){
    res.setHeader("Allow","POST");
    return res.status(405).json({error:"POST required"});
  }

  const expected=process.env.WIKI_CRAWL_TOKEN;
  if(!expected) return res.status(503).json({error:"WIKI_CRAWL_TOKEN is not configured"});
  if(String(req.headers["x-crawl-token"]||"")!==expected){
    return res.status(401).json({error:"Invalid crawl token"});
  }

  const url=process.env.SUPABASE_URL;
  const secret=process.env.SUPABASE_SECRET_KEY;
  if(!url||!secret) return res.status(500).json({error:"Supabase configuration missing"});
  const supabase=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

  const c=req.body?.candidate||{};
  const ulanId=String(c.ulan_id||"");
  const wikiTitle=String(c.wikipedia_title||"").trim();
  const wikiUrl=String(c.wikipedia_url||"");
  const wikidataId=String(c.wikidata_id||"").trim();
  const periodStart=Number(c.period_start);
  const periodEnd=Number(c.period_end);
  const discoveryKind=String(c.discovery_kind||"Wikipedia relationship");
  const sourceArtistUlan=String(c.source_artist_ulan||"");
  const evidenceText=String(c.evidence_text||"").trim().slice(0,1500);
  const candidateRegion=String(c.region||"").trim();
  const candidateName=String(c.canonical_name||wikiTitle||c.seed_name||"").trim();

  if(/^(12|13|14)\d{2}$/.test(candidateName) || /^(12|13|14)\d{2}$/.test(wikiTitle))
    return res.status(200).json({status:"rejected_identity",reason:"Year/date article is not an artist"});
  if(/^\s*,/.test(candidateName))
    return res.status(200).json({status:"rejected_identity",reason:"Malformed leading-punctuation artist name"});

  if(!/^5\d{8}$/.test(ulanId)) return res.status(400).json({error:"A Getty ULAN ID is required for automatic admission"});
  if(!wikiTitle||!validWikiUrl(wikiUrl)) return res.status(400).json({error:"Valid Wikipedia identity required"});
  if(!overlapsWindow(periodStart,periodEnd)){
    return res.status(200).json({status:"rejected_window",reason:"Activity does not overlap 1270–1420"});
  }

  const {count,error:countErr}=await supabase
    .from("artists").select("*",{count:"exact",head:true})
    .not("review_status","like","rejected%");
  if(countErr) return res.status(500).json({error:countErr.message});

  let {data:artist,error:findErr}=await supabase
    .from("artists").select("*").eq("ulan_id",ulanId).maybeSingle();
  if(findErr) return res.status(500).json({error:findErr.message});

  // Older seeded records do not always mirror ULAN/Wikidata/Wikipedia IDs onto
  // artists.ulan_id. Resolve through external_ids before attempting an insert,
  // otherwise admission can create a duplicate artist and then collide with the
  // existing authority-ID uniqueness constraint.
  if(!artist){
    const identityCandidates=[
      {source:"ULAN",external_id:ulanId},
      ...(wikidataId?[{source:"Wikidata",external_id:wikidataId}]:[]),
      ...((wikiTitle&&wikiUrl)?[{
        source:"Wikipedia",
        external_id:`${wikiUrl.includes("it.wikipedia.org")?"it":"en"}:${wikiTitle}`
      }]:[])
    ];
    for(const ident of identityCandidates){
      const {data:ext,error:extErr}=await supabase.from("external_ids")
        .select("artist_id").eq("source",ident.source).eq("external_id",ident.external_id).limit(1);
      if(extErr) return res.status(500).json({error:extErr.message});
      if(ext?.length){
        const {data:existing,error:artistErr}=await supabase.from("artists")
          .select("*").eq("id",ext[0].artist_id).maybeSingle();
        if(artistErr) return res.status(500).json({error:artistErr.message});
        if(existing){
          artist=existing;
          // Opportunistically backfill the direct ULAN column so future resolver
          // passes can find this record without the external-ID fallback.
          if(!artist.ulan_id){
            const {data:updated,error:updateErr}=await supabase.from("artists")
              .update({ulan_id:ulanId}).eq("id",artist.id).select("*").maybeSingle();
            if(updateErr) return res.status(500).json({error:updateErr.message});
            artist=updated||artist;
          }
          break;
        }
      }
    }
  }

  // Re-audited existing artists may now have chronology/geography that older
  // resolver passes could not recover. Patch only missing fields; never overwrite
  // an existing accepted placement automatically.
  let repairedExisting=false;
  if(artist){
    const patch={};
    if(!artist.region && candidateRegion) patch.region=candidateRegion;
    if(!Number.isFinite(Number(artist.floruit_start)) && Number.isFinite(periodStart)) patch.floruit_start=Math.round(periodStart);
    if(!Number.isFinite(Number(artist.floruit_end)) && Number.isFinite(periodEnd)) patch.floruit_end=Math.round(periodEnd);
    if(!Number.isFinite(Number(artist.layout_year)) && (Number.isFinite(periodStart)||Number.isFinite(periodEnd))){
      patch.layout_year=Math.round(Number.isFinite(periodStart)&&Number.isFinite(periodEnd)?(periodStart+periodEnd)/2:(Number.isFinite(periodStart)?periodStart:periodEnd));
    }
    if(!Number.isFinite(Number(artist.region_confidence)) && candidateRegion) patch.region_confidence=Number(c.region_confidence||0.68);
    if(!Number.isFinite(Number(artist.chronology_confidence)) && (Number.isFinite(periodStart)||Number.isFinite(periodEnd))) patch.chronology_confidence=Number(c.chronology_confidence||0.68);
    if(Object.keys(patch).length){
      const {data:updated,error:updateErr}=await supabase.from("artists").update(patch).eq("id",artist.id).select("*").maybeSingle();
      if(updateErr) return res.status(500).json({error:updateErr.message});
      artist=updated||artist;repairedExisting=true;
    }
  }

  let inserted=false;
  if(!artist){
    if((count||0)>=TARGET_TOTAL){
      return res.status(200).json({status:"target_reached",artist_count:count});
    }

    let ulanText="";
    try{
      ulanText=await fetchText(`https://www.getty.edu/vow/ULANFullDisplay?find=&nation=&role=&subjectid=${ulanId}`);
    }catch(e){
      return res.status(200).json({status:"ulan_fetch_failed",reason:e.message});
    }
    const ident=parseUlanIdentity(ulanText,wikiTitle);
    if(ident.recordType && !/^person$/i.test(ident.recordType)){
      return res.status(200).json({status:"rejected_identity",reason:`ULAN record type ${ident.recordType}`});
    }

    const layoutYear=Math.round(
      (Number.isFinite(periodStart)&&Number.isFinite(periodEnd)) ? (periodStart+periodEnd)/2 :
      Number.isFinite(periodStart) ? periodStart : periodEnd
    );

    const entityType=/\b(master|maestro)\b/i.test(ident.preferred||wikiTitle)?"anonymous_master":"person";

    const {data:newArtist,error:insErr}=await supabase
      .from("artists")
      .insert({
        canonical_name:ident.preferred||wikiTitle,
        entity_type:entityType,
        ulan_id:ulanId,
        floruit_start:Number.isFinite(periodStart)?Math.round(periodStart):null,
        floruit_end:Number.isFinite(periodEnd)?Math.round(periodEnd):null,
        layout_year:Number.isFinite(layoutYear)?layoutYear:null,
        region:candidateRegion||deriveRegion(ident.plain),
        region_confidence:0.70,
        chronology_confidence:0.80,
        visibility_score:0,
        default_visible:false,
        review_status:"accepted",
        crawl_depth:1,
        discovery_source:discoveryKind
      })
      .select("*").single();

    if(insErr) return res.status(500).json({error:insErr.message});
    artist=newArtist;
    inserted=true;

    const aliases=[...new Set([
      wikiTitle,
      ...(Array.isArray(c.aliases)?c.aliases:[])
    ].map(x=>String(x||"").trim()).filter(x=>x&&x!==artist.canonical_name))];

    for(const alias of aliases){
      const {data:exists}=await supabase.from("artist_aliases")
        .select("id").eq("artist_id",artist.id).eq("alias",alias).limit(1);
      if(!exists?.length){
        await supabase.from("artist_aliases").insert({
          artist_id:artist.id,alias,language:null,source:"Wikipedia/Wikidata discovery"
        });
      }
    }

    if(wikidataId){
      const {data:exists}=await supabase.from("external_ids")
        .select("id").eq("artist_id",artist.id).eq("source","Wikidata").eq("external_id",wikidataId).limit(1);
      if(!exists?.length){
        await supabase.from("external_ids").insert({
          artist_id:artist.id,source:"Wikidata",external_id:wikidataId,
          url:`https://www.wikidata.org/wiki/${encodeURIComponent(wikidataId)}`
        });
      }
    }

    const language=wikiUrl.includes("it.wikipedia.org")?"it":"en";
    const wikiExternal=`${language}:${wikiTitle}`;
    const {data:wikiExists}=await supabase.from("external_ids")
      .select("id").eq("artist_id",artist.id).eq("source","Wikipedia").eq("external_id",wikiExternal).limit(1);
    if(!wikiExists?.length){
      await supabase.from("external_ids").insert({
        artist_id:artist.id,source:"Wikipedia",external_id:wikiExternal,url:wikiUrl
      });
    }
  }

  let edgeAdded=0,evidenceAdded=0;
  const rel=c.relationship;
  if(rel && sourceArtistUlan && ALLOWED_TYPES.has(String(rel.relationship_type||"").toLowerCase()) &&
     ALLOWED_STYLES.has(String(rel.visual_class||""))){

    const {data:subject,error:sErr}=await supabase.from("artists")
      .select("id,ulan_id,layout_year,birth_year,death_year,floruit_start,floruit_end").eq("ulan_id",sourceArtistUlan).maybeSingle();
    if(sErr) return res.status(500).json({error:sErr.message});

    if(subject && subject.id!==artist.id){
      const familyTypes=new Set([
        "child of","parent of","sibling of","brother of","son of","father of"
      ]);
      const relType=String(rel.relationship_type||"").toLowerCase();
      const subjectYear=[
        subject.layout_year,subject.floruit_start,subject.birth_year,
        subject.floruit_end,subject.death_year
      ].find(Number.isFinite);
      const targetYear=[
        artist.layout_year,artist.floruit_start,artist.birth_year,
        artist.floruit_end,artist.death_year
      ].find(Number.isFinite);

      // New artist admission is independent from relationship admission.
      // A Wikipedia relationship >50 years apart is simply not written.
      if(!familyTypes.has(relType) &&
         Number.isFinite(subjectYear) &&
         Number.isFinite(targetYear) &&
         Math.abs(targetYear-subjectYear)>50){
        return res.status(200).json({
          status:inserted?"inserted":repairedExisting?"updated_existing":"already_present",
          artist_id:artist.id,
          ulan_id:artist.ulan_id,
          canonical_name:artist.canonical_name,
          edge_added:0,
          evidence_added:0,
          relationship_rejected:"chronology_over_50_years"
        });
      }

      const normalized=normalizeRelation(rel,subject.id,artist.id);

      const {data:rels,error:rErr}=await supabase.from("relationships")
        .select("id,from_artist_id,to_artist_id,relationship_type,visual_class,directed");
      if(rErr) return res.status(500).json({error:rErr.message});

      let existing=(rels||[]).find(r=>
        r.visual_class===normalized.visual_class &&
        Boolean(r.directed)===normalized.directed &&
        pairMatches(r,normalized.from_artist_id,normalized.to_artist_id,normalized.directed)
      );

      if(!existing){
        const {data:newRel,error:nErr}=await supabase.from("relationships")
          .insert({...normalized,confidence:Number(c.relationship.confidence||0.72),review_status:"candidate"})
          .select("*").single();
        if(nErr) return res.status(500).json({error:nErr.message});
        existing=newRel;
        edgeAdded=1;
      }

      if(evidenceText){
        const {data:ev}=await supabase.from("relationship_evidence")
          .select("id").eq("relationship_id",existing.id).eq("source","Wikipedia").eq("source_url",wikiUrl).limit(1);
        if(!ev?.length){
          const {error:eErr}=await supabase.from("relationship_evidence").insert({
            relationship_id:existing.id,
            source:"Wikipedia",
            source_url:wikiUrl,
            evidence_text:evidenceText,
            confidence:Number(c.relationship.confidence||0.72),
            review_status:"candidate"
          });
          if(eErr) return res.status(500).json({error:eErr.message});
          evidenceAdded=1;
        }
      }
    }
  }

  return res.status(200).json({
    status:inserted?"inserted":repairedExisting?"updated_existing":"already_present",
    artist_id:artist.id,
    ulan_id:artist.ulan_id,
    canonical_name:artist.canonical_name,
    edge_added:edgeAdded,
    evidence_added:evidenceAdded
  });
};
