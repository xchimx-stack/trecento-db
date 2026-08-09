const { createClient } = require("@supabase/supabase-js");

const ALLOWED_STYLES=new Set(["solid","dashed","dotted"]);
const ALLOWED_TYPES=new Set([
  "collaborated with",
  "worked with",
  "pupil of",
  "student of",
  "teacher of",
  "master of",
  "workshop of",
  "influenced by",
  "influenced",
  "child of",
  "parent of",
  "sibling of",
  "brother of",
  "son of",
  "father of"
]);

function artistYear(a){
  const vals=[
    a?.layout_year,
    a?.floruit_start,
    a?.birth_year,
    a?.floruit_end,
    a?.death_year
  ].filter(Number.isFinite);
  return vals.length ? vals[0] : null;
}

function chronologyCheck(type,fromArtist,toArtist){
  const fy=artistYear(fromArtist);
  const ty=artistYear(toArtist);

  // If we lack chronology, do not reject automatically.
  if(!Number.isFinite(fy)||!Number.isFinite(ty)){
    return {ok:true,reason:null,difference:null};
  }

  const diff=ty-fy;

  // Directional convention in this project:
  // teacher/master -> pupil/student.
  if(["pupil of","student of","workshop of"].includes(type)){
    // The normalized proposal should point teacher -> pupil.
    // Pupil earlier than teacher by >10y is implausible; >50y separation is too large.
    if(diff < -10) return {ok:false,reason:"pupil predates teacher",difference:diff};
    if(diff > 50) return {ok:false,reason:"teacher/pupil gap exceeds 50 years",difference:diff};
  }

  if(["teacher of","master of"].includes(type)){
    if(diff < -10) return {ok:false,reason:"pupil predates teacher",difference:diff};
    if(diff > 50) return {ok:false,reason:"teacher/pupil gap exceeds 50 years",difference:diff};
  }

  // Wikipedia is a secondary textual source. For graph edges we require
  // broad chronological contemporaneity for every non-family relationship,
  // including "influenced by". This deliberately excludes loose historical
  // influence claims such as Giotto -> Masaccio from the relationship graph.
  const familyTypes=new Set([
    "child of","parent of","sibling of","brother of","son of","father of"
  ]);

  if(!familyTypes.has(type) && Math.abs(diff)>50){
    return {ok:false,reason:"Wikipedia relationship gap exceeds 50 years",difference:diff};
  }

  return {ok:true,reason:null,difference:diff};
}


function validWikiUrl(value){
  try{
    const u=new URL(String(value||""));
    return u.protocol==="https:" &&
      (u.hostname==="it.wikipedia.org" || u.hostname==="en.wikipedia.org");
  }catch{return false}
}

function pairMatches(r,fromId,toId,directed){
  if(directed){
    return r.from_artist_id===fromId && r.to_artist_id===toId;
  }
  return (
    (r.from_artist_id===fromId && r.to_artist_id===toId) ||
    (r.from_artist_id===toId && r.to_artist_id===fromId)
  );
}

module.exports=async function handler(req,res){
  if(req.method!=="POST"){
    res.setHeader("Allow","POST");
    return res.status(405).json({error:"POST required"});
  }

  const expected=process.env.WIKI_CRAWL_TOKEN;
  if(!expected) return res.status(503).json({error:"WIKI_CRAWL_TOKEN is not configured"});
  const supplied=String(req.headers["x-crawl-token"]||"");
  if(!supplied || supplied!==expected) return res.status(401).json({error:"Invalid crawl token"});

  const url=process.env.SUPABASE_URL;
  const secret=process.env.SUPABASE_SECRET_KEY;
  if(!url||!secret) return res.status(500).json({error:"Supabase configuration missing"});

  const proposals=Array.isArray(req.body?.proposals)?req.body.proposals:[];
  if(!proposals.length) return res.status(200).json({accepted:0,evidence_added:0,new_edges:0,conflicts:0});
  if(proposals.length>25) return res.status(400).json({error:"Maximum 25 proposals per batch"});

  const supabase=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

  const ulans=[...new Set(proposals.flatMap(p=>[String(p.from_ulan||""),String(p.to_ulan||"")]))]
    .filter(x=>/^5\d{8}$/.test(x));

  const {data:artists,error:aErr}=await supabase
    .from("artists")
    .select("id,ulan_id,canonical_name,layout_year,birth_year,death_year,floruit_start,floruit_end,review_status")
    .in("ulan_id",ulans);
  if(aErr) return res.status(500).json({error:aErr.message});

  const byUlan=new Map((artists||[])
    .filter(a=>!String(a.review_status||"").startsWith("rejected"))
    .map(a=>[String(a.ulan_id),a]));

  const {data:relationships,error:rErr}=await supabase
    .from("relationships")
    .select("id,from_artist_id,to_artist_id,relationship_type,visual_class,directed");
  if(rErr) return res.status(500).json({error:rErr.message});

  const relationshipIds=(relationships||[]).map(r=>r.id);
  let evidence=[];
  if(relationshipIds.length){
    const {data:e,error:eErr}=await supabase
      .from("relationship_evidence")
      .select("id,relationship_id,source,source_url")
      .in("relationship_id",relationshipIds);
    if(eErr) return res.status(500).json({error:eErr.message});
    evidence=e||[];
  }

  const evByRel=new Map();
  for(const e of evidence){
    if(!evByRel.has(e.relationship_id)) evByRel.set(e.relationship_id,[]);
    evByRel.get(e.relationship_id).push(e);
  }

  let evidenceAdded=0,newEdges=0,conflicts=0,accepted=0;

  for(const p of proposals){
    const from=byUlan.get(String(p.from_ulan||""));
    const to=byUlan.get(String(p.to_ulan||""));
    const style=String(p.visual_class||"");
    const type=String(p.relationship_type||"").toLowerCase();
    const directed=Boolean(p.directed);
    const sourceUrl=String(p.source_url||"");
    const evidenceText=String(p.evidence_text||"").trim().slice(0,1500);

    if(!from||!to||from.id===to.id) continue;
    if(!ALLOWED_STYLES.has(style)||!ALLOWED_TYPES.has(type)) continue;
    if(!validWikiUrl(sourceUrl)||!evidenceText) continue;

    // Chronology sanity gate applies only to Wikipedia-generated proposals.
    const chronology=chronologyCheck(type,from,to);
    if(!chronology.ok){
      conflicts++;
      await supabase.from("crawl_events").insert({
        source:"Wikipedia",
        endpoint:sourceUrl,
        artist_id:from.id,
        external_key:`chronology-reject:${from.id}:${to.id}:${type}`,
        response_status:200,
        error_message:`Wikipedia candidate rejected by chronology: ${chronology.reason}; year difference=${chronology.difference}. Evidence: ${evidenceText}`
      });
      continue;
    }

    // 1. Exact semantic edge match: attach Wikipedia evidence whether ULAN or
    // another source already supports it.
    let exact=(relationships||[]).find(r=>
      r.visual_class===style &&
      Boolean(r.directed)===directed &&
      pairMatches(r,from.id,to.id,directed)
    );

    if(exact){
      const exists=(evByRel.get(exact.id)||[]).some(e=>
        e.source==="Wikipedia" && e.source_url===sourceUrl
      );
      if(!exists){
        const {data:ins,error:iErr}=await supabase
          .from("relationship_evidence")
          .insert({
            relationship_id:exact.id,
            source:"Wikipedia",
            source_url:sourceUrl,
            evidence_text:evidenceText,
            confidence:Number.isFinite(Number(p.confidence))?Number(p.confidence):0.70,
            review_status:"candidate"
          })
          .select("id,relationship_id,source,source_url")
          .single();
        if(iErr) return res.status(500).json({error:iErr.message});
        if(!evByRel.has(exact.id)) evByRel.set(exact.id,[]);
        evByRel.get(exact.id).push(ins);
        evidenceAdded++;
      }
      accepted++;
      continue;
    }

    // 2. ULAN already asserts a DIFFERENT relationship between this pair.
    // Wikipedia may not override it. Log as a conflict; don't create a second edge.
    const pairEdges=(relationships||[]).filter(r=>pairMatches(r,from.id,to.id,false));
    const ulanConflict=pairEdges.find(r=>
      (evByRel.get(r.id)||[]).some(e=>e.source==="ULAN")
    );

    if(ulanConflict){
      conflicts++;
      await supabase.from("crawl_events").insert({
        source:"Wikipedia",
        endpoint:sourceUrl,
        artist_id:from.id,
        external_key:`conflict:${from.id}:${to.id}`,
        response_status:200,
        error_message:`Wikipedia candidate not published because ULAN already has a different edge. Proposed ${type}/${style}/${directed}. Evidence: ${evidenceText}`
      });
      continue;
    }

    // 3. ULAN silent: create a Wikipedia-only candidate edge.
    const {data:newRel,error:newErr}=await supabase
      .from("relationships")
      .insert({
        from_artist_id:from.id,
        to_artist_id:to.id,
        relationship_type:type,
        visual_class:style,
        directed,
        confidence:Number.isFinite(Number(p.confidence))?Number(p.confidence):0.65,
        review_status:"candidate"
      })
      .select("id,from_artist_id,to_artist_id,relationship_type,visual_class,directed")
      .single();
    if(newErr) return res.status(500).json({error:newErr.message});

    relationships.push(newRel);

    const {data:ev,error:evErr}=await supabase
      .from("relationship_evidence")
      .insert({
        relationship_id:newRel.id,
        source:"Wikipedia",
        source_url:sourceUrl,
        evidence_text:evidenceText,
        confidence:Number.isFinite(Number(p.confidence))?Number(p.confidence):0.65,
        review_status:"candidate"
      })
      .select("id,relationship_id,source,source_url")
      .single();
    if(evErr) return res.status(500).json({error:evErr.message});

    evByRel.set(newRel.id,[ev]);
    newEdges++;
    evidenceAdded++;
    accepted++;
  }

  res.status(200).json({
    accepted,
    evidence_added:evidenceAdded,
    new_edges:newEdges,
    conflicts
  });
};
