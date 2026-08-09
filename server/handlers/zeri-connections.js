const SEARCH_BASE="https://catalogo.fondazionezeri.unibo.it/ricerca.v2.jsp";
const MAX_RESULT_PAGES=5;

function scopedSearchUrl(name,page=1,batch=100){
  const q=new URLSearchParams({
    decorator:"layout_resp",
    apply:"true",
    percorso_ricerca:"OA",
    sortby:"LOCALIZZAZIONE",
    batch:String(batch),
    view:"list",
    locale:"en",
    AUTN_AUTP_AAT_ROFA_ATBD:String(name||"")
  });
  if(page>1) q.set("page",String(page));
  return `${SEARCH_BASE}?${q.toString()}`;
}

function stripHtml(html){
  return String(html||"")
    .replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]+>/g," ")
    .replace(/&nbsp;|&#160;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/&ndash;|&#8211;/gi,"–")
    .replace(/&mdash;|&#8212;/gi,"—")
    .replace(/\s+/g," ").trim();
}
function norm(s){
  return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[’']/g,"'")
    .replace(/\bst\.?\b/g,"saint")
    .replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}
function titleFrom(html){
  const m=String(html||"").match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return m?stripHtml(m[1]):"Zeri work record";
}
function extractWorkLinks(html){
  const out=[];
  const rx=/href=["']([^"']*(?:\/scheda\/opera\/\d+\/|\/entry\/work\/\d+\/?)[^"']*)["']/gi;
  for(const m of String(html||"").matchAll(rx)){
    let href=m[1].replace(/&amp;/g,"&");
    if(!href.startsWith("http")) href=`https://catalogo.fondazionezeri.unibo.it${href.startsWith("/")?"":"/"}${href}`;
    if(!out.includes(href)) out.push(href);
  }
  return out;
}
function authorFromWorkUrl(url){
  try{
    const u=new URL(url);
    const slug=decodeURIComponent(u.pathname.split("/").filter(Boolean).pop()||"").replace(/\+/g," ").trim();
    if(!slug || /^\d+$/.test(slug)) return null;
    const comma=slug.indexOf(",");
    return (comma>=0?slug.slice(0,comma):slug).trim()||null;
  }catch{return null}
}
function extractAuthorityIds(html){
  const s=String(html||"");
  const ulan=new Set();
  const viaf=new Set();
  for(const m of s.matchAll(/(?:subjectid=|\/ulan\/)(5\d{8})/gi)) ulan.add(m[1]);
  for(const m of s.matchAll(/viaf\.org\/viaf\/(\d{3,20})/gi)) viaf.add(m[1]);
  return {ulan:[...ulan],viaf:[...viaf]};
}

function authorityTokenText(html){
  let s=String(html||"");
  s=s.replace(/<a[^>]+href=["'][^"']*(?:subjectid=|\/ulan\/)(5\d{8})[^"']*["'][^>]*>[\s\S]*?<\/a>/gi," [ULAN:$1] ");
  s=s.replace(/<a[^>]+href=["'][^"']*viaf\.org\/viaf\/(\d{3,20})\/?[^"']*["'][^>]*>[\s\S]*?<\/a>/gi," [VIAF:$1] ");
  return stripHtml(s);
}
function extractNamedAuthorityIds(html,name){
  const text=authorityTokenText(html);
  const target=norm(name);
  const result={ulan:[],viaf:[]};
  const rx=/Autore\s+(.+?)(?=\s+Motivazione dell['’]attribuzione|\s+Autore\s+|$)/gi;
  for(const m of text.matchAll(rx)){
    const block=m[1];
    const clean=block.replace(/\[(?:ULAN|VIAF):[^\]]+\]/g," ").replace(/\s+/g," ").trim();
    const n=norm(clean);
    if(!(n===target||n.includes(target)||target.includes(n))) continue;
    for(const x of block.matchAll(/\[ULAN:(5\d{8})\]/g)) if(!result.ulan.includes(x[1])) result.ulan.push(x[1]);
    for(const x of block.matchAll(/\[VIAF:(\d{3,20})\]/g)) if(!result.viaf.includes(x[1])) result.viaf.push(x[1]);
  }
  return result;
}

function extractTotalPages(html){
  const text=stripHtml(html);
  const m=text.match(/page\s+\d+\s+of\s+(\d+)/i);
  return m?Math.max(1,Number(m[1])||1):1;
}

function extractOtherAttributionsFacet(html){
  // Zeri renders the OTHER ATTRIBUTIONS facet in the initial HTML response.
  // Parse only that facet; never infer associations from broad free-text results.
  const raw=String(html||"");
  const text=stripHtml(raw);
  const upper=text.toUpperCase();
  const start=upper.indexOf("OTHER ATTRIBUTIONS");
  if(start<0) return [];
  const nextHeadings=["ARTIST","DATE","LOCATION","OBJECT","SUBJECT","AUTHOR","SCHOOL"];
  let end=text.length;
  for(const h of nextHeadings){
    const i=upper.indexOf(h,start+20);
    if(i>start && i<end) end=i;
  }
  const section=text.slice(start+"OTHER ATTRIBUTIONS".length,end);
  const out=[];
  const seen=new Set();
  // Common facet rendering is "Name 167 Name 36 ..."; capture a label followed by count.
  const rx=/([A-ZÀ-ÖØ-Ý"'“”][A-Za-zÀ-ÖØ-öø-ÿ0-9'’"“”().,\- ]{2,120}?)\s+\(?(\d{1,6})\)?(?=\s+[A-ZÀ-ÖØ-Ý"'“”]|$)/g;
  for(const m of section.matchAll(rx)){
    const label=m[1].replace(/\s+/g," ").trim();
    const count=Number(m[2]);
    const key=norm(label);
    if(!key||!Number.isFinite(count)||seen.has(key)) continue;
    seen.add(key);out.push({artist:label,count});
  }
  return out.sort((a,b)=>b.count-a.count||a.artist.localeCompare(b.artist));
}
async function get(url){
  const r=await fetch(url,{headers:{"User-Agent":"TrecentoNetwork/0.16 Zeri authority reader"},redirect:"follow"});
  if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return {text:await r.text(),url:r.url||url};
}
async function viafFromWikidata(qid){
  if(!/^Q\d+$/.test(String(qid||""))) return null;
  try{
    const r=await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(qid)}.json`,{headers:{"User-Agent":"TrecentoNetwork/0.16 authority crosswalk"}});
    if(!r.ok) return null;
    const j=await r.json();
    const claims=j.entities?.[qid]?.claims?.P214||[];
    for(const c of claims){
      const v=c?.mainsnak?.datavalue?.value;
      if(/^\d{3,20}$/.test(String(v||""))) return String(v);
    }
  }catch{}
  return null;
}
function authorityMatch(ids,ulan,viaf){
  if(ulan && ids.ulan.includes(String(ulan))) return {matched:true,basis:"ULAN",id:String(ulan)};
  if(viaf && ids.viaf.includes(String(viaf))) return {matched:true,basis:"VIAF",id:String(viaf)};
  return {matched:false,basis:null,id:null};
}

async function resolveZeriBasis(name){
  const searchUrl=scopedSearchUrl(name,1,100);
  try{
    const search=await get(searchUrl);
    const links=extractWorkLinks(search.text);
    if(!links.length) return {matched:false,url:searchUrl,reason:"no_scoped_results"};
    for(const url of links.slice(0,6)){
      try{
        const page=await get(url);
        const ids=extractNamedAuthorityIds(page.text,name);
        if(ids.ulan.length||ids.viaf.length){
          return {matched:true,url:searchUrl,ulan_id:ids.ulan[0]||null,viaf_id:ids.viaf[0]||null,authority_record:url};
        }
      }catch{}
    }
    return {matched:false,url:searchUrl,reason:"no_authority_id"};
  }catch(e){
    return {matched:false,url:searchUrl,reason:"request_failed",warning:e.message};
  }
}

module.exports=async function handler(req,res){
  res.setHeader("Cache-Control","s-maxage=86400, stale-while-revalidate=604800");
  const name=String(req.query?.name||"").trim();
  if(!name) return res.status(400).json({error:"name required"});

  if(String(req.query?.mode||"")==="resolve"){
    const result=await resolveZeriBasis(name);
    return res.status(200).json(result);
  }

  const threshold=Math.max(1,Math.min(20,Number(req.query?.threshold)||3));
  const ulan=/^5\d{8}$/.test(String(req.query?.ulan||""))?String(req.query.ulan):null;
  let viaf=/^\d{3,20}$/.test(String(req.query?.viaf||""))?String(req.query.viaf):null;
  const qid=/^Q\d+$/.test(String(req.query?.qid||""))?String(req.query.qid):null;
  if(!viaf && qid) viaf=await viafFromWikidata(qid);

  const searchUrl=scopedSearchUrl(name,1,100);
  if(!ulan && !viaf){
    return res.status(200).json({
      artist:name,source:"Fondazione Federico Zeri",search_url:searchUrl,
      identity_status:"no_authority",identity_basis:null,works_checked:0,
      threshold,associations:[],
      message:"No ULAN or VIAF identifier is available for Zeri cross-reference."
    });
  }

  try{
    const first=await get(searchUrl);
    const totalPages=Math.min(MAX_RESULT_PAGES,extractTotalPages(first.text));
    const pages=[first];
    for(let page=2;page<=totalPages;page++){
      try{pages.push(await get(scopedSearchUrl(name,page,100)))}catch{}
    }

    const workLinks=[];
    for(const page of pages){
      for(const link of extractWorkLinks(page.text)) if(!workLinks.includes(link)) workLinks.push(link);
    }

    if(!workLinks.length){
      return res.status(200).json({artist:name,source:"Fondazione Federico Zeri",search_url:searchUrl,identity_status:"no_results",identity_basis:null,works_checked:0,threshold,associations:[]});
    }

    // Verify that the scoped result set actually contains the requested authority.
    let identity={matched:false,basis:null,id:null};
    for(const url of workLinks.slice(0,10)){
      try{
        const page=await get(url);
        identity=authorityMatch(extractNamedAuthorityIds(page.text,name),ulan,viaf);
        if(identity.matched) break;
      }catch{}
    }
    if(!identity.matched){
      return res.status(200).json({
        artist:name,source:"Fondazione Federico Zeri",search_url:searchUrl,
        identity_status:"no_authority_match",identity_basis:null,works_checked:workLinks.length,
        threshold,associations:[],
        message:"Zeri results were found, but no matching ULAN or VIAF identifier was present in the sampled Zeri records."
      });
    }

    // In an author/attribution/school search, a result whose catalogued/current
    // author differs from the queried artist is itself evidence of an alternate
    // attribution. Count recurrence across the scoped work set; do not use free text.
    const target=norm(name);
    const associations=new Map();
    for(const url of workLinks){
      const author=authorFromWorkUrl(url);
      if(!author) continue;
      const key=norm(author);
      if(!key || key===target || key.includes(target) || target.includes(key)) continue;
      if(!associations.has(key)) associations.set(key,{artist:author,count:0,works:[]});
      const item=associations.get(key);
      item.count++;
      if(item.works.length<4) item.works.push({title:"Zeri work record",url});
    }

    const results=[...associations.values()]
      .filter(x=>x.count>=threshold)
      .sort((a,b)=>b.count-a.count || a.artist.localeCompare(b.artist))
      .slice(0,12);

    return res.status(200).json({
      artist:name,source:"Fondazione Federico Zeri",search_url:searchUrl,
      identity_status:"matched",identity_basis:identity.basis,identity_id:identity.id,
      viaf_id:viaf||null,works_checked:workLinks.length,threshold,associations:results
    });
  }catch(e){
    return res.status(200).json({
      artist:name,source:"Fondazione Federico Zeri",search_url:searchUrl,
      identity_status:"request_failed",identity_basis:null,works_checked:0,
      threshold,associations:[],warning:e.message
    });
  }
};

module.exports._test={
  scopedSearchUrl,stripHtml,norm,extractWorkLinks,authorFromWorkUrl,
  extractAuthorityIds,authorityTokenText,extractNamedAuthorityIds,extractTotalPages,extractOtherAttributionsFacet,authorityMatch,resolveZeriBasis,titleFrom
};
