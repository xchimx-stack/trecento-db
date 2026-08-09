const { createClient } = require("@supabase/supabase-js");

const WD_API="https://www.wikidata.org/w/api.php";
const ENWIKI_API="https://en.wikipedia.org/w/api.php";
const ITWIKI_API="https://it.wikipedia.org/w/api.php";

const STORAGE_BUCKET="artist-thumbnails";

// Default assumes a 1 GiB storage allowance and deliberately caps media at 50%.
// If the project plan changes, set SUPABASE_STORAGE_CAPACITY_BYTES in Vercel.
const DEFAULT_STORAGE_CAPACITY_BYTES=1024*1024*1024;
const STORAGE_CAPACITY_BYTES=Number(
  process.env.SUPABASE_STORAGE_CAPACITY_BYTES || DEFAULT_STORAGE_CAPACITY_BYTES
);
const MEDIA_STORAGE_FRACTION=0.50;
const MEDIA_STORAGE_LIMIT_BYTES=Math.floor(STORAGE_CAPACITY_BYTES*MEDIA_STORAGE_FRACTION);

// Keep Wikimedia requests serialized inside a warm serverless instance.
globalThis.__trecentoMediaQueue = globalThis.__trecentoMediaQueue || Promise.resolve();

function apiUrl(base,params){
  const u=new URL(base);
  for(const [k,v] of Object.entries(params)) u.searchParams.set(k,String(v));
  return u.toString();
}

function norm(s){
  return String(s||"")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g," ")
    .trim();
}

function uniqueStrings(items){
  return [...new Set(items.map(x=>String(x||"").trim()).filter(Boolean))];
}

function italianizeMasterName(name){
  const s=String(name||"").trim();
  if(!s) return null;
  if(/^master of the /i.test(s)) return s.replace(/^master of the /i,"Maestro del ");
  if(/^master of /i.test(s)) return s.replace(/^master of /i,"Maestro di ");
  if(/^maestro /i.test(s)) return s;
  return null;
}

function claimValues(entity,pid){
  return (entity?.claims?.[pid]||[])
    .map(c=>c?.mainsnak?.datavalue?.value)
    .filter(v=>v!==undefined&&v!==null)
    .map(v=>typeof v==="object"?(v.id||v["numeric-id"]||JSON.stringify(v)):String(v));
}

function yearFromWikidataTime(v){
  const t=v?.time || v;
  const m=String(t||"").match(/([+-])(\d{4,})-/);
  if(!m) return null;
  const y=Number(m[2]);
  return m[1]==="-" ? -y : y;
}

function entityYears(entity){
  const birth=(entity?.claims?.P569||[])
    .map(c=>yearFromWikidataTime(c?.mainsnak?.datavalue?.value))
    .find(Number.isFinite) ?? null;
  const death=(entity?.claims?.P570||[])
    .map(c=>yearFromWikidataTime(c?.mainsnak?.datavalue?.value))
    .find(Number.isFinite) ?? null;
  return {birth,death};
}

function labelCandidates(entity){
  const vals=[];
  for(const lang of ["en","it"]){
    const label=entity?.labels?.[lang]?.value;
    if(label) vals.push(label);
    for(const alias of entity?.aliases?.[lang]||[]){
      if(alias?.value) vals.push(alias.value);
    }
  }
  return vals;
}

function scoreCandidate(entity,artist,aliases){
  let score=0;
  const artistNames=[artist.canonical_name,...aliases].map(norm).filter(Boolean);
  const candidateNames=labelCandidates(entity).map(norm).filter(Boolean);

  for(const a of artistNames){
    for(const c of candidateNames){
      if(a===c) score=Math.max(score,70);
      else if(a.includes(c)||c.includes(a)) score=Math.max(score,48);
    }
  }

  const desc=norm([
    entity?.descriptions?.en?.value||"",
    entity?.descriptions?.it?.value||""
  ].join(" "));
  if(/\b(painter|artist|fresco|illuminator|sculptor|architect|pittore|artista|miniatore|scultore|architetto)\b/.test(desc)) score+=12;
  if(entity?.sitelinks?.enwiki || entity?.sitelinks?.itwiki) score+=10;

  const years=entityYears(entity);
  const targetYears=[
    artist.birth_year,artist.death_year,
    artist.floruit_start,artist.floruit_end,
    artist.layout_year
  ].filter(Number.isFinite);

  if(targetYears.length){
    const candidates=[years.birth,years.death].filter(Number.isFinite);
    if(candidates.length){
      const minDiff=Math.min(...targetYears.flatMap(y=>candidates.map(c=>Math.abs(y-c))));
      if(minDiff<=5) score+=12;
      else if(minDiff<=15) score+=8;
      else if(minDiff<=30) score+=3;
      else if(minDiff>80) score-=15;
    }
  }
  return score;
}

function usableImage(title){
  const t=String(title||"").toLowerCase();
  if(!/\.(jpg|jpeg|png|webp|tif|tiff)$/i.test(t)) return false;
  return !/(logo|icon|commons-logo|wikimedia|edit-clear|question_book|disambig|symbol|map|locator|flag|coat of arms|signature)/i.test(t);
}

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function fetchWithBackoff(url,opts={},attempt=0){
  const headers={
    "User-Agent":"TrecentoNetwork/1.0 (art-history research visualization; Wikimedia enrichment)",
    ...(opts.headers||{})
  };

  const r=await fetch(url,{...opts,headers});

  if(r.status===429 && attempt<3){
    const retryHeader=r.headers.get("retry-after");
    const retrySeconds=retryHeader && /^\d+$/.test(retryHeader)
      ? Number(retryHeader)
      : Math.min(2**attempt,8);
    await sleep(Math.max(1000,retrySeconds*1000));
    return fetchWithBackoff(url,opts,attempt+1);
  }

  if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r;
}

async function fetchJson(url){
  return (await fetchWithBackoff(url)).json();
}

async function ensureStorageBucket(supabase){
  const {data:buckets,error:listErr}=await supabase.storage.listBuckets();
  if(listErr) throw listErr;
  if((buckets||[]).some(b=>b.name===STORAGE_BUCKET)) return;

  const {error:createErr}=await supabase.storage.createBucket(STORAGE_BUCKET,{
    public:true,
    fileSizeLimit:"2MB",
    allowedMimeTypes:["image/jpeg","image/png","image/webp"]
  });
  if(createErr && !/already exists/i.test(createErr.message||"")) throw createErr;
}

async function currentBucketUsageBytes(supabase){
  let offset=0;
  let total=0;
  const limit=1000;

  while(true){
    const {data,error}=await supabase.storage.from(STORAGE_BUCKET).list("",{
      limit,offset,sortBy:{column:"name",order:"asc"}
    });
    if(error) throw error;

    const rows=data||[];
    for(const row of rows){
      const size=Number(row?.metadata?.size);
      if(Number.isFinite(size)) total+=size;
    }

    if(rows.length<limit) break;
    offset+=limit;
  }
  return total;
}

function extensionFromContentType(type,url){
  const t=String(type||"").toLowerCase();
  if(t.includes("png")) return "png";
  if(t.includes("webp")) return "webp";
  if(t.includes("jpeg")||t.includes("jpg")) return "jpg";

  const m=String(url||"").match(/\.(jpg|jpeg|png|webp)(?:$|\?)/i);
  return (m?.[1]||"jpg").replace("jpeg","jpg").toLowerCase();
}

async function cacheThumbnail(supabase,ulan,sourceUrl){
  await ensureStorageBucket(supabase);

  const usage=await currentBucketUsageBytes(supabase);
  if(usage>=MEDIA_STORAGE_LIMIT_BYTES){
    return {
      stored:false,
      reason:"media_storage_limit",
      storage_used_bytes:usage,
      storage_limit_bytes:MEDIA_STORAGE_LIMIT_BYTES,
      public_url:null
    };
  }

  const response=await fetchWithBackoff(sourceUrl);
  const contentType=(response.headers.get("content-type")||"image/jpeg").split(";")[0];
  const buffer=Buffer.from(await response.arrayBuffer());

  if(usage+buffer.length>MEDIA_STORAGE_LIMIT_BYTES){
    return {
      stored:false,
      reason:"media_storage_limit",
      storage_used_bytes:usage,
      storage_limit_bytes:MEDIA_STORAGE_LIMIT_BYTES,
      public_url:null
    };
  }

  const ext=extensionFromContentType(contentType,sourceUrl);
  const path=`${ulan}.${ext}`;

  const {error:uploadErr}=await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path,buffer,{
      contentType,
      upsert:true,
      cacheControl:"31536000"
    });
  if(uploadErr) throw uploadErr;

  const {data:pub}=supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return {
    stored:true,
    reason:null,
    storage_used_bytes:usage+buffer.length,
    storage_limit_bytes:MEDIA_STORAGE_LIMIT_BYTES,
    public_url:pub?.publicUrl||null
  };
}

async function resolveArtistMedia(supabase,artist,aliases,cacheMap){
  let entity=null,qid=null,matchMethod=null,matchScore=null;

  // 1) Reuse cached Wikidata QID if available.
  const cachedQid=cacheMap.get("Wikidata")?.external_id||null;
  if(cachedQid && /^Q\d+$/.test(cachedQid)){
    try{
      const data=await fetchJson(apiUrl(WD_API,{
        action:"wbgetentities",
        ids:cachedQid,
        props:"claims|sitelinks|labels|descriptions|aliases",
        languages:"en|it",
        format:"json",
        origin:"*"
      }));
      const e=data.entities?.[cachedQid];
      if(e && !e.missing){
        entity=e;qid=cachedQid;matchMethod="cached_wikidata";matchScore=100;
      }
    }catch{}
  }

  // 2) Minimal Wikidata search: preferred name + at most one Italianized master form.
  if(!entity){
    const queries=uniqueStrings([
      artist.canonical_name,
      italianizeMasterName(artist.canonical_name)
    ]).slice(0,2);

    const idSet=new Set();
    for(const q of queries){
      for(const lang of ["en","it"]){
        const search=await fetchJson(apiUrl(WD_API,{
          action:"wbsearchentities",
          search:q,
          language:lang,
          uselang:lang,
          type:"item",
          limit:6,
          format:"json",
          origin:"*"
        }));
        for(const hit of search.search||[]) if(hit.id) idSet.add(hit.id);
        if(idSet.size>=10) break;
      }
      if(idSet.size>=10) break;
    }

    const ids=[...idSet].slice(0,10);
    if(ids.length){
      const entities=await fetchJson(apiUrl(WD_API,{
        action:"wbgetentities",
        ids:ids.join("|"),
        props:"claims|sitelinks|labels|descriptions|aliases",
        languages:"en|it",
        format:"json",
        origin:"*"
      }));

      // Exact ULAN first.
      for(const id of ids){
        const e=entities.entities?.[id];
        if(claimValues(e,"P245").includes(String(artist.ulan_id))){
          entity=e;qid=id;matchMethod="ulan_exact";matchScore=100;break;
        }
      }

      // Conservative scored fallback.
      if(!entity){
        const scored=ids
          .map(id=>({id,entity:entities.entities?.[id]}))
          .filter(x=>x.entity)
          .map(x=>({...x,score:scoreCandidate(x.entity,artist,aliases)}))
          .sort((a,b)=>b.score-a.score);

        const best=scored[0],second=scored[1];
        if(best && best.score>=70 && (!second || best.score-second.score>=8)){
          entity=best.entity;qid=best.id;matchMethod="scored_fallback";matchScore=best.score;
        }
      }
    }
  }

  if(!entity||!qid){
    return {
      wikidata:null,wikipedia:null,wikipedia_language:null,
      source_image:null,match_method:"none",match_score:null
    };
  }

  const enTitle=entity.sitelinks?.enwiki?.title||null;
  const itTitle=entity.sitelinks?.itwiki?.title||null;
  const wikiTitle=enTitle||itTitle||null;
  const wikiLanguage=enTitle?"en":(itTitle?"it":null);

  if(!wikiTitle||!wikiLanguage){
    return {
      wikidata:`https://www.wikidata.org/wiki/${qid}`,
      qid,wikipedia:null,wikipedia_language:null,
      source_image:null,match_method:matchMethod,match_score:matchScore
    };
  }

  const wikiApi=wikiLanguage==="it"?ITWIKI_API:ENWIKI_API;
  const wikipedia=`https://${wikiLanguage}.wikipedia.org/wiki/${encodeURIComponent(wikiTitle.replace(/ /g,"_"))}`;

  // One image request only: page lead/representative image.
  const lead=await fetchJson(apiUrl(wikiApi,{
    action:"query",
    titles:wikiTitle,
    prop:"pageimages",
    piprop:"thumbnail|original",
    pithumbsize:900,
    format:"json",
    origin:"*"
  }));
  const page=Object.values(lead.query?.pages||{})[0];
  const sourceImage=page?.thumbnail?.source||null;

  return {
    wikidata:`https://www.wikidata.org/wiki/${qid}`,
    qid,
    wikipedia,
    wikipedia_language:wikiLanguage,
    source_image:sourceImage,
    match_method:matchMethod,
    match_score:matchScore
  };
}

module.exports=async function handler(req,res){
  res.setHeader("Cache-Control","s-maxage=86400, stale-while-revalidate=604800");

  const supabaseUrl=process.env.SUPABASE_URL;
  const secret=process.env.SUPABASE_SECRET_KEY;
  if(!supabaseUrl||!secret){
    return res.status(500).json({error:"Supabase configuration missing"});
  }

  const ulan=String(req.query?.ulan||"").trim();
  if(!/^5\d{8}$/.test(ulan)){
    return res.status(400).json({error:"Valid ULAN ID required"});
  }

  const supabase=createClient(supabaseUrl,secret,{
    auth:{persistSession:false,autoRefreshToken:false}
  });

  const {data:artist,error:aErr}=await supabase
    .from("artists")
    .select("id,canonical_name,ulan_id,birth_year,death_year,floruit_start,floruit_end,layout_year")
    .eq("ulan_id",ulan)
    .maybeSingle();
  if(aErr) return res.status(500).json({error:aErr.message});
  if(!artist) return res.status(404).json({error:"Artist not found"});

  const {data:aliasRows,error:aliasErr}=await supabase
    .from("artist_aliases")
    .select("alias")
    .eq("artist_id",artist.id);
  if(aliasErr) return res.status(500).json({error:aliasErr.message});
  const aliases=(aliasRows||[]).map(x=>x.alias).filter(Boolean);

  const {data:cached,error:cErr}=await supabase
    .from("external_ids")
    .select("source,external_id,url")
    .eq("artist_id",artist.id);
  if(cErr) return res.status(500).json({error:cErr.message});

  const cacheMap=new Map((cached||[]).map(x=>[x.source,x]));

  // Fully cached artist: zero Wikimedia requests.
  if(cacheMap.has("Wikipedia") && cacheMap.has("SupabaseThumbnail")){
    return res.status(200).json({
      cached:true,
      wikidata:cacheMap.get("Wikidata")?.url||null,
      wikipedia:cacheMap.get("Wikipedia")?.url||null,
      wikipedia_language:cacheMap.get("WikipediaLanguage")?.external_id||null,
      image:cacheMap.get("SupabaseThumbnail")?.url||null,
      match_method:cacheMap.get("WikipediaMatchMethod")?.external_id||"cached",
      match_score:null,
      media_storage_fraction:MEDIA_STORAGE_FRACTION
    });
  }

  // Serialize the actual enrichment work inside this runtime instance.
  let release;
  const previous=globalThis.__trecentoMediaQueue;
  globalThis.__trecentoMediaQueue=new Promise(r=>{release=r});

  await previous.catch(()=>{});

  try{
    const resolved=await resolveArtistMedia(supabase,artist,aliases,cacheMap);

    const rows=[];

    if(resolved.qid){
      rows.push({
        artist_id:artist.id,
        source:"Wikidata",
        external_id:resolved.qid,
        url:resolved.wikidata
      });
    }

    if(resolved.wikipedia){
      const title=decodeURIComponent(resolved.wikipedia.split("/wiki/")[1]||"").replace(/_/g," ");
      rows.push({
        artist_id:artist.id,
        source:"Wikipedia",
        external_id:`${resolved.wikipedia_language}:${title}`,
        url:resolved.wikipedia
      },{
        artist_id:artist.id,
        source:"WikipediaLanguage",
        external_id:resolved.wikipedia_language,
        url:null
      });
    }

    rows.push({
      artist_id:artist.id,
      source:"WikipediaMatchMethod",
      external_id:resolved.match_method||"none",
      url:null
    });

    let imageUrl=cacheMap.get("SupabaseThumbnail")?.url||null;
    let storageStatus=null;

    if(!imageUrl && resolved.source_image){
      storageStatus=await cacheThumbnail(supabase,ulan,resolved.source_image);

      if(storageStatus.stored && storageStatus.public_url){
        imageUrl=storageStatus.public_url;
        rows.push({
          artist_id:artist.id,
          source:"SupabaseThumbnail",
          external_id:`${STORAGE_BUCKET}:${ulan}`,
          url:imageUrl
        });
      }
    }

    if(rows.length){
      const {error:uErr}=await supabase
        .from("external_ids")
        .upsert(rows,{onConflict:"artist_id,source"});
      if(uErr) throw uErr;
    }

    return res.status(200).json({
      cached:false,
      wikidata:resolved.wikidata,
      wikipedia:resolved.wikipedia,
      wikipedia_language:resolved.wikipedia_language,
      image:imageUrl,
      match_method:resolved.match_method,
      match_score:resolved.match_score,
      media_storage_fraction:MEDIA_STORAGE_FRACTION,
      media_storage_limit_bytes:MEDIA_STORAGE_LIMIT_BYTES,
      media_storage_status:storageStatus?.reason||"ok"
    });
  }catch(e){
    console.error("artist-media enrichment failed",e);
    return res.status(502).json({
      error:e.message,
      wikipedia:null,
      image:null,
      match_method:"request_failed"
    });
  }finally{
    release();
  }
};
