const { createClient } = require("@supabase/supabase-js");

const WD_API="https://www.wikidata.org/w/api.php";
const ENWIKI_API="https://en.wikipedia.org/w/api.php";
const ITWIKI_API="https://it.wikipedia.org/w/api.php";

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


function norm(s){
  return String(s||"")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g," ")
    .trim();
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


function italianizeMasterName(name){
  const s=String(name||"").trim();
  if(!s) return null;
  if(/^master of the /i.test(s)) return s.replace(/^master of the /i,"Maestro del ");
  if(/^master of /i.test(s)) return s.replace(/^master of /i,"Maestro di ");
  if(/^maestro /i.test(s)) return s;
  return null;
}

function uniqueStrings(items){
  return [...new Set(items.map(x=>String(x||"").trim()).filter(Boolean))];
}

function scoreCandidate(entity,artist,aliases){
  let score=0;
  const artistNames=[artist.canonical_name,...aliases].map(norm).filter(Boolean);
  const candidateNames=labelCandidates(entity).map(norm).filter(Boolean);

  for(const a of artistNames){
    for(const c of candidateNames){
      if(a===c) score=Math.max(score,70);
      else if(a.includes(c) || c.includes(a)) score=Math.max(score,48);
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
    artist.birth_year, artist.death_year,
    artist.floruit_start, artist.floruit_end,
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
  const hasPositiveCache=cacheMap.has("Wikidata") || cacheMap.has("Wikipedia");

  if(hasPositiveCache){
    return res.status(200).json({
      cached:true,
      wikidata:cacheMap.get("Wikidata")?.url||null,
      wikipedia:cacheMap.get("Wikipedia")?.url||null,
      wikipedia_language:cacheMap.get("WikipediaLanguage")?.external_id||null,
      images:[
        cacheMap.get("WikimediaImage1")?.url,
        cacheMap.get("WikimediaImage2")?.url
      ].filter(Boolean)
    });
  }

  try{
    // Search Wikidata in both English and Italian.
    // For anonymous artists, transform "Master of ..." into "Maestro di/del ..."
    // for the Italian query rather than relying on literal English wording.
    const queryForms=uniqueStrings([
      artist.canonical_name,
      ...aliases,
      italianizeMasterName(artist.canonical_name),
      ...aliases.map(italianizeMasterName)
    ]);

    const idSet=new Set();

    for(const q of queryForms.slice(0,8)){
      const languages = italianizeMasterName(q) || /^maestro\b/i.test(q)
        ? ["it","en"]
        : ["en","it"];

      for(const lang of languages){
        const search=await fetchJson(apiUrl(WD_API,{
          action:"wbsearchentities",
          search:q,
          language:lang,
          uselang:lang,
          type:"item",
          limit:8,
          format:"json",
          origin:"*"
        }));
        for(const hit of search.search||[]){
          if(hit.id) idSet.add(hit.id);
        }
        if(idSet.size>=16) break;
      }
      if(idSet.size>=16) break;
    }

    const ids=[...idSet].slice(0,16);

    let entity=null,qid=null;
    let matchMethod=null;
    let matchScore=null;

    if(ids.length){
      const entities=await fetchJson(apiUrl(WD_API,{
        action:"wbgetentities",
        ids:ids.join("|"),
        props:"claims|sitelinks|labels|descriptions|aliases",
        languages:"en|it",
        format:"json",
        origin:"*"
      }));

      // 1) Exact ULAN identifier is authoritative when present.
      for(const id of ids){
        const e=entities.entities?.[id];
        const ulanClaims=claimValues(e,"P245");
        if(ulanClaims.includes(ulan)){
          entity=e; qid=id; matchMethod="ulan_exact"; matchScore=100;
          break;
        }
      }

      // 2) Fallback to a conservative scored match.
      if(!entity){
        const scored=ids
          .map(id=>({id,entity:entities.entities?.[id]}))
          .filter(x=>x.entity)
          .map(x=>({...x,score:scoreCandidate(x.entity,artist,aliases)}))
          .sort((a,b)=>b.score-a.score);

        const best=scored[0];
        const second=scored[1];

        // Require a strong score and some separation from the runner-up.
        if(best && best.score>=70 && (!second || best.score-second.score>=8)){
          entity=best.entity;
          qid=best.id;
          matchMethod="scored_fallback";
          matchScore=best.score;
        }
      }
    }

    if(!entity||!qid){
      // Do not persist a permanent negative cache. Sparse Wikidata records may
      // become matchable later as identifiers/aliases improve.
      return res.status(200).json({
        cached:false,
        wikidata:null,
        wikipedia:null,
        images:[],
        match_method:null,
        match_score:null
      });
    }

    const enTitle=entity.sitelinks?.enwiki?.title||null;
    const itTitle=entity.sitelinks?.itwiki?.title||null;

    // Prefer English when present; otherwise use Italian Wikipedia.
    const wikiTitle=enTitle||itTitle||null;
    const wikiLanguage=enTitle ? "en" : (itTitle ? "it" : null);
    const wikiApi=wikiLanguage==="it" ? ITWIKI_API : ENWIKI_API;

    const rows=[{
      artist_id:artist.id,
      source:"Wikidata",
      external_id:qid,
      url:`https://www.wikidata.org/wiki/${qid}`
    }];

    let wikipediaUrl=null;
    const images=[];

    if(wikiTitle && wikiLanguage){
      wikipediaUrl=`https://${wikiLanguage}.wikipedia.org/wiki/${encodeURIComponent(wikiTitle.replace(/ /g,"_"))}`;
      rows.push({
        artist_id:artist.id,
        source:"Wikipedia",
        external_id:`${wikiLanguage}:${wikiTitle}`,
        url:wikipediaUrl
      });

      // Keep the language explicit for future UI/search logic.
      rows.push({
        artist_id:artist.id,
        source:"WikipediaLanguage",
        external_id:wikiLanguage,
        url:null
      });

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
      if(page?.thumbnail?.source){
        images.push({title:page.pageimage||"lead",url:page.thumbnail.source});
      }

      const imgs=await fetchJson(apiUrl(wikiApi,{
        action:"query",
        titles:wikiTitle,
        generator:"images",
        gimlimit:24,
        prop:"imageinfo",
        iiprop:"url",
        iiurlwidth:900,
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
      wikipedia_language:wikiLanguage,
      images:images.slice(0,2).map(x=>x.url),
      match_method:matchMethod,
      match_score:matchScore
    });
  }catch(e){
    console.error("artist-media enrichment failed",e);
    return res.status(502).json({error:e.message,wikipedia:null,images:[]});
  }
};
