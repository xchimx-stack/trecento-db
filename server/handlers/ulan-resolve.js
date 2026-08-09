const RECONCILE="https://services.getty.edu/vocab/reconcile/";
const ULAN_PAGE=id=>`https://www.getty.edu/vow/ULANFullDisplay?find=&nation=&role=&subjectid=${id}`;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function request(url,options={},attempt=0){
  const r=await fetch(url,{
    ...options,
    headers:{
      "User-Agent":"TrecentoNetwork/1.1 ULAN identity resolver",
      ...(options.headers||{})
    }
  });
  if((r.status===429||r.status===503)&&attempt<4){
    const retry=Number(r.headers.get("retry-after")||0);
    const delay=Math.max(retry*1000,700*Math.pow(2,attempt));
    await sleep(delay);
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
    .replace(/&amp;/gi,"&")
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/&ndash;|&#8211;/gi,"–")
    .replace(/&mdash;|&#8212;/gi,"—")
    .replace(/\s+/g," ")
    .trim();
}

function norm(s){
  return String(s||"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/\b(the|il|lo|la|i|gli|le|of|di|del|della|delle|dei|da)\b/g," ")
    .replace(/[^a-z0-9]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function naturalName(s){
  s=String(s||"").trim();
  if(!s.includes(",")) return s;
  const [family,...rest]=s.split(",");
  const given=rest.join(",").trim();
  return given?`${given} ${family.trim()}`:s;
}

function masterVariants(s){
  s=naturalName(String(s||"").trim());
  const out=[s];
  if(/^master of the /i.test(s)){
    const tail=s.replace(/^master of the /i,"");
    out.push(`Maestro del ${tail}`,`Maestro della ${tail}`,`Maestro delle ${tail}`,`Maestro dei ${tail}`,`Maestro di ${tail}`);
  }else if(/^master of /i.test(s)){
    const tail=s.replace(/^master of /i,"");
    out.push(`Maestro di ${tail}`,`Maestro del ${tail}`,`Maestro della ${tail}`,`Maestro delle ${tail}`);
  }
  if(/^maestro (?:di|del|della|delle|dei) /i.test(s)){
    const tail=s.replace(/^maestro (?:di|del|della|delle|dei) /i,"");
    out.push(`Master of ${tail}`,`Master of the ${tail}`);
  }
  return [...new Set(out.map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean))];
}

function saneName(s){
  s=String(s||"").trim();
  if(!s||s.length>110) return false;
  if(/\b(active|probably|believed?|documented|workshop|pupil|apprentice|teacher|same artist|century|died|born|flourished)\b/i.test(s)) return false;
  return true;
}

function parseIdentity(text){
  const recordType=(text.match(/Record Type:\s*([A-Za-z ]+?)(?=\s+[A-Z][^:]{0,40}:|\s+\()/i)?.[1]||"").trim();
  let preferred=null;
  const aliases=[];

  const start=text.indexOf("Names:");
  if(start>=0){
    let section=text.slice(start);
    const stop=section.search(/Nationalities:|Roles:|Gender:|Related People or Corporate Bodies:/i);
    if(stop>0) section=section.slice(0,stop);
    const rx=/([A-ZÀ-ÖØ-öø-ÿ][^()]{1,180}?)\s*\(([^)]*)\)/g;
    for(const m of section.matchAll(rx)){
      const name=m[1].replace(/^Names:\s*/i,"").replace(/\.+/g," ").replace(/\s+/g," ").trim();
      const flags=String(m[2]||"").toLowerCase();
      if(!saneName(name)) continue;
      if(flags.includes("preferred")&&!preferred) preferred=name;
      if(!aliases.includes(name)) aliases.push(name);
    }
  }

  return {recordType,preferred,aliases};
}

function deriveRegion(text){
  const t=String(text||"").toLowerCase();
  if(/\bvenetian\b|\bvenice\b|\bpadua\b|\bpaduan\b|\bpadova\b/.test(t)) return "Veneto";
  if(/\bflorentine\b|\bflorence\b|\bfirenze\b|\btuscan\b|\btuscany\b/.test(t)) return "Florence";
  if(/\bsienese\b|\bsiena\b/.test(t)) return "Siena";
  if(/\bbolognese\b|\bbologna\b/.test(t)) return "Bologna";
  if(/\brimini\b|\briminese\b/.test(t)) return "Rimini";
  if(/\bpisa\b|\bpisan\b/.test(t)) return "Pisa";
  if(/\brome\b|\broman\b|\broma\b/.test(t)) return "Rome";
  if(/\bnaples\b|\bneapolitan\b|\bnapoli\b/.test(t)) return "Naples";
  return null;
}

function derivePeriod(text){
  const idx=text.indexOf("Record Type:");
  const section=idx>=0?text.slice(idx,idx+1900):text.slice(0,1900);
  const years=[...section.matchAll(/\b(12\d{2}|13\d{2}|14\d{2})\b/g)].map(m=>Number(m[1]));
  if(years.length>=2 && Math.abs(years[1]-years[0])<=180){
    return {start:Math.min(years[0],years[1]),end:Math.max(years[0],years[1])};
  }
  if(years.length===1) return {start:years[0],end:years[0]};
  return {start:null,end:null};
}

function isArtistRole(text){
  return /\b(painter|painting|sculptor|sculpture|illuminator|miniaturist|artist|draftsman|draughtsman|pittore|scultore|miniatore|artista)\b/i.test(String(text||""));
}

function italianContext(text){
  return /\b(italian|italy|tuscany|tuscan|florentine|florence|sienese|siena|venetian|venice|bolognese|bologna|rimini|pisa|padua|rome|naples)\b/i.test(String(text||""));
}

function tokenSimilarity(a,b){
  const A=new Set(norm(a).split(" ").filter(Boolean));
  const B=new Set(norm(b).split(" ").filter(Boolean));
  if(!A.size||!B.size) return 0;
  let intersection=0;
  for(const x of A) if(B.has(x)) intersection++;
  return (2*intersection)/(A.size+B.size);
}

function bestNameSimilarity(identityNames,queryNames){
  let best=0;
  for(const a of identityNames){
    for(const b of queryNames){
      const na=norm(a),nb=norm(b);
      if(!na||!nb) continue;
      if(na===nb) best=Math.max(best,1);
      else if(na.includes(nb)||nb.includes(na)) best=Math.max(best,.88);
      else best=Math.max(best,tokenSimilarity(a,b));
    }
  }
  return best;
}

function periodScore(candidatePeriod,targetStart,targetEnd){
  if(!Number.isFinite(targetStart)||!Number.isFinite(targetEnd)) return 0;
  if(!Number.isFinite(candidatePeriod.start)||!Number.isFinite(candidatePeriod.end)) return 0;

  const targetMid=(targetStart+targetEnd)/2;
  const candidateMid=(candidatePeriod.start+candidatePeriod.end)/2;
  const gap=Math.abs(candidateMid-targetMid);

  if(gap<=10) return 18;
  if(gap<=25) return 12;
  if(gap<=50) return 5;
  if(gap>90) return -30;
  return -12;
}

async function reconcile(names){
  const unique=[...new Set(names.map(x=>String(x||"").trim()).filter(Boolean))].slice(0,12);
  const collected=new Map();

  for(let i=0;i<unique.length;i+=6){
    const batch=unique.slice(i,i+6);
    const queries={};
    batch.forEach((name,j)=>queries[`q${j}`]={query:name,type:"/ulan"});

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
    const data=await r.json();

    batch.forEach((query,j)=>{
      for(const x of data?.[`q${j}`]?.result||[]){
        const id=String(x.id||"").split("/").pop();
        if(!/^5\d{8}$/.test(id)) continue;
        const prev=collected.get(id)||{
          id,name:x.name||null,reconcileScore:0,reconcileMatch:false,queries:[]
        };
        prev.reconcileScore=Math.max(prev.reconcileScore,Number(x.score)||0);
        prev.reconcileMatch=prev.reconcileMatch||Boolean(x.match);
        if(!prev.queries.includes(query)) prev.queries.push(query);
        collected.set(id,prev);
      }
    });
    await sleep(180);
  }

  return [...collected.values()]
    .sort((a,b)=>(b.reconcileMatch-a.reconcileMatch)||(b.reconcileScore-a.reconcileScore))
    .slice(0,8);
}

async function enrichCandidate(c,queryNames,targetStart,targetEnd,contextText){
  const r=await request(ULAN_PAGE(c.id));
  const plain=decodeHtml(await r.text());
  const ident=parseIdentity(plain);
  const period=derivePeriod(plain);
  const region=deriveRegion(plain);
  const nameSim=bestNameSimilarity(
    [ident.preferred,c.name,...ident.aliases].filter(Boolean),
    queryNames
  );

  let score=0;
  score+=nameSim*55;
  score+=Math.min(12,(Number(c.reconcileScore)||0)*.12);
  if(c.reconcileMatch) score+=8;
  score+=periodScore(period,targetStart,targetEnd);

  const artistRole=isArtistRole(plain);
  if(artistRole) score+=13;
  else score-=22;

  const italian=italianContext(plain);
  if(italian) score+=8;

  // If Wikipedia context clearly says artist/painter and ULAN lacks an artist
  // role, penalize more heavily.
  if(isArtistRole(contextText)&&!artistRole) score-=12;

  if(ident.recordType && !/^person$/i.test(ident.recordType)) score-=45;

  return {
    ...c,
    preferred:ident.preferred||c.name,
    aliases:ident.aliases,
    recordType:ident.recordType,
    period,
    region,
    nameSimilarity:Number(nameSim.toFixed(3)),
    artistRole,
    italian,
    score:Number(score.toFixed(1))
  };
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

  const body=req.body||{};
  const direct=String(body.wikidata_ulan_id||"").trim();
  if(/^5\d{8}$/.test(direct)){
    return res.status(200).json({
      status:"direct",
      ulan_id:direct,
      confidence:100,
      reason:"Wikidata P245"
    });
  }

  const aliases=Array.isArray(body.aliases)?body.aliases:[];
  const titleIt=String(body.title_it||"").trim();
  const titleEn=String(body.title_en||"").trim();
  const display=String(body.display_name||"").trim();

  const seedNames=[display,titleIt,titleEn,...aliases].filter(Boolean);
  const queryNames=[];
  for(const name of seedNames){
    queryNames.push(naturalName(name));
    queryNames.push(...masterVariants(name));
  }
  const uniqueNames=[...new Set(queryNames.map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean))];

  if(!uniqueNames.length){
    return res.status(200).json({status:"no_match",reason:"No usable identity names"});
  }

  let candidates;
  try{
    candidates=await reconcile(uniqueNames);
  }catch(e){
    return res.status(502).json({error:`ULAN reconciliation failed: ${e.message}`});
  }

  if(!candidates.length){
    return res.status(200).json({
      status:"no_match",
      searched_names:uniqueNames
    });
  }

  const targetStart=Number(body.period_start);
  const targetEnd=Number(body.period_end);
  const contextText=String(body.context_text||"");

  const enriched=[];
  for(const c of candidates.slice(0,6)){
    try{
      enriched.push(await enrichCandidate(
        c,uniqueNames,
        Number.isFinite(targetStart)?targetStart:null,
        Number.isFinite(targetEnd)?targetEnd:null,
        contextText
      ));
    }catch(e){
      enriched.push({...c,score:-999,error:e.message});
    }
    await sleep(140);
  }

  enriched.sort((a,b)=>b.score-a.score);
  const best=enriched[0];
  const second=enriched[1];

  // Conservative automatic identity threshold:
  // - strong absolute score
  // - meaningful separation from runner-up
  // - artist-like ULAN record
  // - credible name similarity
  const margin=second ? best.score-second.score : 999;
  const auto=
    best &&
    best.score>=72 &&
    margin>=14 &&
    best.artistRole &&
    best.nameSimilarity>=.60 &&
    (!best.recordType || /^person$/i.test(best.recordType));

  if(auto){
    return res.status(200).json({
      status:"matched",
      ulan_id:best.id,
      confidence:Math.min(99,Math.round(best.score)),
      margin:Number(margin.toFixed(1)),
      method:"ULAN reconcile + identity scoring",
      matched_name:best.preferred,
      matched_region:best.region,
      matched_period:best.period,
      searched_names:uniqueNames,
      candidates:enriched.slice(0,3)
    });
  }

  if(best && best.score>=52 && best.nameSimilarity>=.45){
    return res.status(200).json({
      status:"ambiguous",
      confidence:Math.max(0,Math.round(best.score)),
      margin:Number(margin.toFixed(1)),
      searched_names:uniqueNames,
      candidates:enriched.slice(0,4)
    });
  }

  return res.status(200).json({
    status:"no_match",
    searched_names:uniqueNames,
    candidates:enriched.slice(0,3)
  });
};
