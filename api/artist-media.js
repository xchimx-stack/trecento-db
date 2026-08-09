const { createClient } = require("@supabase/supabase-js");

const WD_API="https://www.wikidata.org/w/api.php";
const ENWIKI_API="https://en.wikipedia.org/w/api.php";

function apiUrl(base,params){
  const u=new URL(base);
  for(const [k,v] of Object.entries(params)) u.searchParams.set(k,String(v));
  return u.toString();
}

function claimValues(entity,pid){
  return (entity?.claims?.[pid]||[])
    .map(c=>c?.mainsnak?.datavalue?.value)
    .filter(v=>v!==undefined&&v!==null)
    .map(v=>typeof v==="object"?(v.id||v["numeric-id"]||JSON.stringify(v)):String(v));
}

function usableImage(title){
  const t=String(title||"").toLowerCase();
  if(!/\.(jpg|jpeg|png|webp|tif|tiff)$/i.test(t)) return false;
  return !/(logo|icon|commons-logo|wikimedia|edit-clear|question_book|disambig|symbol|map|locator|flag|coat of arms|signature)/i.test(t);
}

async function fetchJson(url){
  const r=await fetch(url,{headers:{"User-Agent":"TrecentoNetwork/1.0 Wikipedia enrichment"}});
  if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

module.exports=async function handler(req,res){
  res.setHeader("Cache-Control","s-maxage=86400, stale-while-revalidate=604800");

  const supabaseUrl=process.env.SUPABASE_URL;
  const secret=process.env.SUPABASE_SECRET_KEY;
  if(!supabaseUrl||!secret) return res.status(500).json({error:"Supabase configuration missing"});

  const ulan=String(req.query?.ulan||"").trim();
  if(!/^5\d{8}$/.test(ulan)) return res.status(400).json({error:"Valid ULAN ID required"});

  const supabase=createClient(supabaseUrl,secret,{auth:{persistSession:false,autoRefreshToken:false}});

  const {data:artist,error:aErr}=await supabase
    .from("artists")
    .select("id,canonical_name,ulan_id")
    .eq("ulan_id",ulan)
    .maybeSingle();
  if(aErr) return res.status(500).json({error:aErr.message});
  if(!artist) return res.status(404).json({error:"Artist not found"});

  const {data:cached,error:cErr}=await supabase
    .from("external_ids")
    .select("source,external_id,url")
    .eq("artist_id",artist.id);
  if(cErr) return res.status(500).json({error:cErr.message});

  const cacheMap=new Map((cached||[]).map(x=>[x.source,x]));
  const hasResolved=cacheMap.has("Wikidata") || cacheMap.has("WikipediaNone");

  if(hasResolved){
    return res.status(200).json({
      cached:true,
      wikidata:cacheMap.get("Wikidata")?.url||null,
      wikipedia:cacheMap.get("Wikipedia")?.url||null,
      images:[
        cacheMap.get("WikimediaImage1")?.url,
        cacheMap.get("WikimediaImage2")?.url
      ].filter(Boolean)
    });
  }

  try{
    // Search a small candidate set by canonical name.
    const search=await fetchJson(apiUrl(WD_API,{
      action:"wbsearchentities",
      search:artist.canonical_name,
      language:"en",
      uselang:"en",
      type:"item",
      limit:8,
      format:"json",
      origin:"*"
    }));
    const ids=(search.search||[]).map(x=>x.id).filter(Boolean);

    let entity=null,qid=null;
    if(ids.length){
      const entities=await fetchJson(apiUrl(WD_API,{
        action:"wbgetentities",
        ids:ids.join("|"),
        props:"claims|sitelinks|labels|descriptions",
        languages:"en",
        format:"json",
        origin:"*"
      }));
      for(const id of ids){
        const e=entities.entities?.[id];
        const ulanClaims=claimValues(e,"P245");
        if(ulanClaims.includes(ulan)){
          entity=e;qid=id;break;
        }
      }
    }

    // Precision-first: do not invent a Wikipedia match when Wikidata does not
    // independently tie the item to this ULAN identifier.
    if(!entity||!qid){
      await supabase.from("external_ids").upsert({
        artist_id:artist.id,
        source:"WikipediaNone",
        external_id:`no-match:${ulan}`,
        url:null
      },{onConflict:"artist_id,source"});
      return res.status(200).json({cached:false,wikidata:null,wikipedia:null,images:[]});
    }

    const wikiTitle=entity.sitelinks?.enwiki?.title||null;
    const rows=[{
      artist_id:artist.id,
      source:"Wikidata",
      external_id:qid,
      url:`https://www.wikidata.org/wiki/${qid}`
    }];

    let wikipediaUrl=null;
    const images=[];

    if(wikiTitle){
      wikipediaUrl=`https://en.wikipedia.org/wiki/${encodeURIComponent(wikiTitle.replace(/ /g,"_"))}`;
      rows.push({
        artist_id:artist.id,
        source:"Wikipedia",
        external_id:wikiTitle,
        url:wikipediaUrl
      });

      // Lead image.
      const lead=await fetchJson(apiUrl(ENWIKI_API,{
        action:"query",
        titles:wikiTitle,
        prop:"pageimages",
        piprop:"thumbnail|original",
        pithumbsize:700,
        format:"json",
        origin:"*"
      }));
      const page=Object.values(lead.query?.pages||{})[0];
      if(page?.thumbnail?.source){
        images.push({title:page.pageimage||"lead",url:page.thumbnail.source});
      }

      // Additional article images, enough to find one useful non-logo work image.
      const imgs=await fetchJson(apiUrl(ENWIKI_API,{
        action:"query",
        titles:wikiTitle,
        generator:"images",
        gimlimit:20,
        prop:"imageinfo",
        iiprop:"url",
        iiurlwidth:700,
        format:"json",
        origin:"*"
      }));
      for(const p of Object.values(imgs.query?.pages||{})){
        if(images.length>=2) break;
        const title=p.title||"";
        const thumb=p.imageinfo?.[0]?.thumburl||p.imageinfo?.[0]?.url;
        if(!thumb||!usableImage(title)) continue;
        if(images.some(x=>x.url===thumb)) continue;
        images.push({title,url:thumb});
      }
    }

    images.slice(0,2).forEach((img,i)=>{
      rows.push({
        artist_id:artist.id,
        source:`WikimediaImage${i+1}`,
        external_id:`${qid}:${i+1}:${img.title}`,
        url:img.url
      });
    });

    if(rows.length){
      const {error:uErr}=await supabase
        .from("external_ids")
        .upsert(rows,{onConflict:"artist_id,source"});
      if(uErr) throw uErr;
    }

    return res.status(200).json({
      cached:false,
      wikidata:`https://www.wikidata.org/wiki/${qid}`,
      wikipedia:wikipediaUrl,
      images:images.slice(0,2).map(x=>x.url)
    });
  }catch(e){
    console.error("artist-media enrichment failed",e);
    return res.status(502).json({error:e.message,wikipedia:null,images:[]});
  }
};
