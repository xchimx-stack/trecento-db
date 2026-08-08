import fs from "node:fs/promises";

const SEEDS = new URL("../data/seed-artists.json", import.meta.url);
const OUT = new URL("../data/imported-artists.json", import.meta.url);
const WD = "https://www.wikidata.org/w/api.php";
const COMMONS = "https://commons.wikimedia.org/w/api.php";
const GETTY = "https://vocab.getty.edu/sparql";

const sleep = ms => new Promise(r => setTimeout(r, ms));

let lastRequestAt = 0;
const MIN_REQUEST_GAP_MS = 450;

async function rateLimit(){
  const now=Date.now();
  const wait=Math.max(0, MIN_REQUEST_GAP_MS-(now-lastRequestAt));
  if(wait) await sleep(wait);
  lastRequestAt=Date.now();
}

async function getJSON(url, attempt=0) {
  await rateLimit();
  const r = await fetch(url, {
    headers:{
      "User-Agent":"TrecentoNetwork/0.4.1 research prototype (Vercel scale test)",
      "Accept":"application/json"
    }
  });

  if (r.status === 429 || r.status === 503) {
    if(attempt >= 6) throw new Error(`${r.status} ${r.statusText} after retries`);
    const retryAfter = Number(r.headers.get("retry-after"));
    const backoff = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(30000, 1200 * (2 ** attempt));
    console.warn(`Rate limited (${r.status}); retrying in ${backoff} ms`);
    await sleep(backoff);
    return getJSON(url, attempt+1);
  }

  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${url}`);
  return r.json();
}
async function wdSearch(name) {
  const u=new URL(WD); u.search=new URLSearchParams({
    action:"wbsearchentities",search:name,language:"en",format:"json",limit:"5",origin:"*"
  });
  return (await getJSON(u)).search || [];
}
async function wdEntity(qid) {
  const u=new URL(WD); u.search=new URLSearchParams({
    action:"wbgetentities",ids:qid,props:"labels|descriptions|claims|sitelinks",languages:"en|it",
    format:"json",origin:"*"
  });
  return (await getJSON(u)).entities?.[qid];
}
async function wikiInfo(lang,title) {
  if(!title) return null;
  const u=new URL(`https://${lang}.wikipedia.org/w/api.php`);
  u.search=new URLSearchParams({
    action:"query",titles:title,prop:"info|categories",cllimit:"max",format:"json",origin:"*"
  });
  const page=Object.values((await getJSON(u)).query?.pages||{})[0];
  if(!page || page.missing!==undefined) return null;
  const categories=(page.categories||[]).map(c=>c.title.replace(/^Category:/,""));
  return {
    title,
    length:page.length||0,
    is_stub:categories.some(c=>/\bstubs?\b/i.test(c)),
    url:`https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(" ","_"))}`
  };
}
function claim(entity,p){
  return entity?.claims?.[p]?.[0]?.mainsnak?.datavalue?.value ?? null;
}
function timeYear(entity,p){
  const v=claim(entity,p);
  const t=v?.time;
  if(!t) return null;
  const m=String(t).match(/^([+-]?\d{1,6})-/);
  if(!m) return null;
  const y=Number(m[1]);
  return Number.isFinite(y) ? y : null;
}
function entityId(entity,p){
  const v=claim(entity,p);
  return v?.id || null;
}

async function ulanSearch(name){
  const escaped=name.replaceAll("\\","\\\\").replaceAll('"','\\"');
  const q=`PREFIX skos:<http://www.w3.org/2004/02/skos/core#>
SELECT ?s ?label WHERE {
 ?s skos:prefLabel ?label .
 FILTER(STRSTARTS(STR(?s),"http://vocab.getty.edu/ulan/"))
 FILTER(CONTAINS(LCASE(STR(?label)),LCASE("${escaped}")))
} LIMIT 5`;
  const u=new URL(GETTY); u.searchParams.set("query",q);
  u.searchParams.set("format","application/sparql-results+json");
  try {
    const j=await getJSON(u);
    return (j.results?.bindings||[]).map(b=>({
      id:b.s?.value?.split("/").pop(), uri:b.s?.value, label:b.label?.value
    }));
  } catch(e) { return []; }
}

async function main(){
  const seed=JSON.parse(await fs.readFile(SEEDS,"utf8"));
  const out=[];
  for(const row of seed.artists){
    const name=row.seed_name;
    console.log("Resolving",name);
    try {
      const candidates=await wdSearch(name);
      const qid=candidates[0]?.id||null;
      const entity=qid ? await wdEntity(qid) : null;
      const enTitle=entity?.sitelinks?.enwiki?.title||null;
      const itTitle=entity?.sitelinks?.itwiki?.title||null;
      const en=await wikiInfo("en",enTitle);
      const it=await wikiInfo("it",itTitle);
      const preferred=(en && !en.is_stub) ? {...en,language:"en"} :
                      it ? {...it,language:"it"} :
                      en ? {...en,language:"en"} : null;
      const commons=claim(entity,"P373");
      const birth_year=timeYear(entity,"P569");
      const death_year=timeYear(entity,"P570");
      const inception_year=timeYear(entity,"P571");
      const floruit_start=timeYear(entity,"P1317");
      const floruit_end=timeYear(entity,"P1318");
      const label=entity?.labels?.en?.value || entity?.labels?.it?.value || name;
      const description=entity?.descriptions?.en?.value || entity?.descriptions?.it?.value || null;

      let ulanCandidates=[];
      try { ulanCandidates=await ulanSearch(name); }
      catch(e){ console.warn(`ULAN failed for ${name}: ${e.message}`); }

      out.push({
        seed_name:name,
        canonical_name:label,
        description,
        wikidata:{
          qid,
          candidates:candidates.slice(0,3).map(x=>({id:x.id,label:x.label,description:x.description})),
          birth_year, death_year, inception_year, floruit_start, floruit_end
        },
        wikipedia:{en,it,preferred},
        commons:{category:commons},
        ulan:{candidates:ulanCandidates},
        review_status:"unreviewed"
      });
    } catch(e) {
      console.warn(`Enrichment failed for ${name}: ${e.message}`);
      out.push({
        seed_name:name,
        canonical_name:name,
        description:null,
        wikidata:{qid:null,candidates:[]},
        wikipedia:{en:null,it:null,preferred:null},
        commons:{category:null},
        ulan:{candidates:[]},
        review_status:"import_failed",
        import_error:e.message
      });
    }

    // Additional artist-level pacing for shared cloud IPs.
    await sleep(650);
  }
  await fs.writeFile(OUT,JSON.stringify({
    generated_at:new Date().toISOString(),
    count:out.length,
    note:"Identity candidates require review before production. No AI-inferred influence is asserted here.",
    artists:out
  },null,2));
  console.log(`Wrote ${out.length} records`);
}
main().catch(e=>{console.error(e);process.exit(1)});
