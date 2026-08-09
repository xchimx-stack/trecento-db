const { createClient } = require("@supabase/supabase-js");

const VALID_REGIONS=new Set(["Naples","Rome","Pisa","Siena","Florence","Bologna","Rimini","Veneto"]);
const YEAR_MIN=1270,YEAR_MAX=1420;

function norm(s){
  return String(s||"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[’']/g,"'")
    .replace(/\bst\.?\b/g,"saint")
    .replace(/[^a-z0-9]+/g," ")
    .replace(/\s+/g," ").trim();
}
function overlaps(a,b){
  return Number.isFinite(a)&&Number.isFinite(b)&&a<=YEAR_MAX&&b>=YEAR_MIN;
}
function validHttp(url){
  return /^https:\/\/[^ ]+$/i.test(String(url||""));
}

module.exports = async function handler(req,res){
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
  const canonicalName=String(c.canonical_name||c.wikipedia_title||c.seed_name||"").trim();
  const periodStart=Number(c.period_start);
  const periodEnd=Number(c.period_end);
  const region=String(c.region||"").trim();
  const ulanId=/^5\d{8}$/.test(String(c.ulan_id||""))?String(c.ulan_id):null;
  const wikipediaUrl=validHttp(c.wikipedia_url)?String(c.wikipedia_url):null;
  const wikipediaTitle=String(c.wikipedia_title||"").trim();
  const wikidataId=/^Q\d+$/.test(String(c.wikidata_id||""))?String(c.wikidata_id):null;
  const viafId=/^\d{3,20}$/.test(String(c.viaf_id||""))?String(c.viaf_id):null;
  const zeriUrl=validHttp(c.zeri_url)?String(c.zeri_url):null;
  const requestedTier=String(c.network_tier||"").toLowerCase()==="comprehensive"?"comprehensive":null;
  const discoverySource=requestedTier==="comprehensive"?"Trecento illuminator category admission":"Trecento finite candidate admission";

  const basis=[ulanId?"ULAN":null,viafId?"VIAF":null,wikipediaUrl?"Wikipedia":null,zeriUrl?"Zeri":null].filter(Boolean);
  if(!canonicalName) return res.status(400).json({error:"Canonical artist name required"});
  if(!basis.length) return res.status(400).json({error:"At least one external basis is required"});
  if(!overlaps(periodStart,periodEnd)){
    return res.status(200).json({status:"not_placeable",reason:"Chronology does not overlap 1270–1420"});
  }
  if(!VALID_REGIONS.has(region)){
    return res.status(200).json({status:"not_placeable",reason:"A defensible mapped region is required"});
  }

  // Strong dedupe keys first.
  let artist=null;
  if(ulanId){
    const {data,error}=await supabase.from("artists").select("*").eq("ulan_id",ulanId).maybeSingle();
    if(error) return res.status(500).json({error:error.message});
    artist=data||null;
  }


  if(!artist && viafId){
    const {data:ext,error}=await supabase.from("external_ids")
      .select("artist_id").eq("source","VIAF").eq("external_id",viafId).limit(1);
    if(error) return res.status(500).json({error:error.message});
    if(ext?.length){
      const {data,error:aErr}=await supabase.from("artists").select("*").eq("id",ext[0].artist_id).maybeSingle();
      if(aErr) return res.status(500).json({error:aErr.message});
      artist=data||null;
    }
  }

  if(!artist && wikidataId){
    const {data:ext,error}=await supabase.from("external_ids")
      .select("artist_id").eq("source","Wikidata").eq("external_id",wikidataId).limit(1);
    if(error) return res.status(500).json({error:error.message});
    if(ext?.length){
      const {data,error:aErr}=await supabase.from("artists").select("*").eq("id",ext[0].artist_id).maybeSingle();
      if(aErr) return res.status(500).json({error:aErr.message});
      artist=data||null;
    }
  }

  if(!artist && wikipediaUrl){
    const {data:ext,error}=await supabase.from("external_ids")
      .select("artist_id").eq("source","Wikipedia").eq("url",wikipediaUrl).limit(1);
    if(error) return res.status(500).json({error:error.message});
    if(ext?.length){
      const {data,error:aErr}=await supabase.from("artists").select("*").eq("id",ext[0].artist_id).maybeSingle();
      if(aErr) return res.status(500).json({error:aErr.message});
      artist=data||null;
    }
  }

  // A name match alone is never an automatic identity merge. Medieval artists can
  // share conventional or personal names across generations. Authority IDs merge;
  // name-only collisions are held for review.
  if(!artist){
    const {data:names,error}=await supabase.from("artists").select("id,canonical_name,ulan_id,birth_year,death_year,floruit_start,floruit_end,layout_year,region,review_status");
    if(error) return res.status(500).json({error:error.message});
    const matches=(names||[]).filter(a=>norm(a.canonical_name)===norm(canonicalName) && !String(a.review_status||"").startsWith("rejected"));
    if(matches.length){
      return res.status(200).json({
        status:"duplicate_review",
        reason:"Name-only identity collision requires authority/manual review",
        matches:matches.map(x=>({id:x.id,name:x.canonical_name,ulan_id:x.ulan_id||null,year:x.layout_year||x.floruit_start||x.birth_year||null,region:x.region||null}))
      });
    }
  }

  let inserted=false;
  const layoutYear=Math.round((periodStart+periodEnd)/2);
  if(!artist){
    const entityType=/\b(master|maestro)\b/i.test(canonicalName)?"anonymous_master":"person";
    const {data,error}=await supabase.from("artists").insert({
      canonical_name:canonicalName,
      entity_type:entityType,
      ulan_id:ulanId,
      floruit_start:Math.round(periodStart),
      floruit_end:Math.round(periodEnd),
      layout_year:layoutYear,
      region,
      region_confidence:Number(c.region_confidence||0.72),
      chronology_confidence:Number(c.chronology_confidence||0.78),
      visibility_score:0,
      default_visible:false,
      review_status:"accepted",
      crawl_depth:1,
      discovery_source:discoverySource,
      manual_tier:requestedTier
    }).select("*").single();
    if(error) return res.status(500).json({error:error.message});
    artist=data;
    inserted=true;
  }

  if(artist && requestedTier==="comprehensive" && String(artist.manual_tier||"").toLowerCase()!=="comprehensive"){
    const {data:updated,error:updateErr}=await supabase.from("artists")
      .update({manual_tier:"comprehensive",discovery_source:artist.discovery_source||discoverySource})
      .eq("id",artist.id).select("*").single();
    if(updateErr) return res.status(500).json({error:updateErr.message});
    artist=updated;
  }

  // Store aliases without overwriting the canonical source fields.
  const aliases=[...new Set([
    c.seed_name,wikipediaTitle,...(Array.isArray(c.aliases)?c.aliases:[])
  ].map(x=>String(x||"").trim()).filter(x=>x && x!==artist.canonical_name))];
  for(const alias of aliases){
    const {data:exists}=await supabase.from("artist_aliases")
      .select("id").eq("artist_id",artist.id).eq("alias",alias).limit(1);
    if(!exists?.length){
      await supabase.from("artist_aliases").insert({artist_id:artist.id,alias,language:null,source:"Discovery admission"});
    }
  }

  const externals=[];
  if(ulanId) externals.push({source:"ULAN",external_id:ulanId,url:`https://www.getty.edu/vow/ULANFullDisplay?find=&nation=&role=&subjectid=${encodeURIComponent(ulanId)}`});
  if(wikidataId) externals.push({source:"Wikidata",external_id:wikidataId,url:`https://www.wikidata.org/wiki/${encodeURIComponent(wikidataId)}`});
  if(viafId) externals.push({source:"VIAF",external_id:viafId,url:`https://viaf.org/viaf/${encodeURIComponent(viafId)}`});
  if(wikipediaUrl) externals.push({source:"Wikipedia",external_id:`${wikipediaUrl.includes("it.wikipedia.org")?"it":"en"}:${wikipediaTitle||canonicalName}`,url:wikipediaUrl});
  if(zeriUrl) externals.push({source:"Zeri",external_id:zeriUrl,url:zeriUrl});

  for(const x of externals){
    const {data:exists}=await supabase.from("external_ids")
      .select("id").eq("artist_id",artist.id).eq("source",x.source).eq("external_id",x.external_id).limit(1);
    if(!exists?.length){
      const {error}=await supabase.from("external_ids").insert({artist_id:artist.id,...x});
      if(error) return res.status(500).json({error:error.message});
    }
  }

  return res.status(200).json({
    status:inserted?"inserted":"already_present",
    artist_id:artist.id,
    canonical_name:artist.canonical_name,
    network_tier:requestedTier||"expanded",
    basis,
    region,
    period_start:periodStart,
    period_end:periodEnd
  });
};

module.exports._test={norm,overlaps};
