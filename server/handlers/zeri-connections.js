const MAX_WORKS=10;
const SEARCH=name=>`https://catalogo.fondazionezeri.unibo.it/ricerca.v2.jsp?fulltext=${encodeURIComponent(name)}`;

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
function extractWorkLinks(html){
  const out=[];
  const rx=/href=["']([^"']*\/scheda\/opera\/\d+\/[^"']+)["']/gi;
  for(const m of String(html||"").matchAll(rx)){
    const href=m[1].startsWith("http")?m[1]:`https://catalogo.fondazionezeri.unibo.it${m[1].startsWith("/")?"":"/"}${m[1]}`;
    if(!out.includes(href)) out.push(href);
  }
  return out.slice(0,MAX_WORKS);
}
function section(text,startLabel,endLabels){
  const start=text.indexOf(startLabel);
  if(start<0) return "";
  let end=text.length;
  for(const label of endLabels){
    const i=text.indexOf(label,start+startLabel.length);
    if(i>=0&&i<end) end=i;
  }
  return text.slice(start+startLabel.length,end).trim();
}
function parseAuthors(sectionText){
  const out=[];
  const rx=/Autore\s+(.+?)(?=\s+Motivazione dell'attribuzione|\s+Autore\s+|$)/g;
  for(const m of sectionText.matchAll(rx)){
    const name=m[1]
      .replace(/\[\s*(VIAF|ULAN|WIKIDATA|WIKIPEDIA|DBPEDIA)\s*\]/gi," ")
      .replace(/\s+/g," ").trim();
    if(name && name.length<120 && !out.includes(name)) out.push(name);
  }
  return out;
}
function titleFrom(html){
  const m=String(html||"").match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return m?stripHtml(m[1]):"Zeri work record";
}
async function get(url){
  const r=await fetch(url,{headers:{"User-Agent":"TrecentoNetwork/0.15 Zeri attribution-history reader"},redirect:"follow"});
  if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return {text:await r.text(),url:r.url||url};
}


async function resolveZeriBasis(name){
  const q=encodeURIComponent(name);
  const urls=[
    `https://catalogo.fondazionezeri.unibo.it/ricerca.v2.jsp?fulltext=${q}`,
    `https://fondazionezeri.unibo.it/it/ricerca?query=${q}`
  ];
  const tokens=name.toLowerCase().replace(/[^a-zà-ÿ0-9 ]/g," ").split(/\s+/).filter(x=>x.length>3);
  for(const url of urls){
    try{
      const r=await fetch(url,{headers:{"User-Agent":"TrecentoNetwork/0.15.1 Zeri resolver"},redirect:"follow"});
      if(!r.ok) continue;
      const text=(await r.text()).toLowerCase();
      const hits=tokens.filter(x=>text.includes(x)).length;
      if(tokens.length && hits>=Math.min(2,tokens.length)){
        return {matched:true,url:r.url||url};
      }
    }catch{}
  }
  return {matched:false,url:null};
}

module.exports=async function handler(req,res){
  res.setHeader("Cache-Control","s-maxage=86400, stale-while-revalidate=604800");
  const name=String(req.query?.name||"").trim();
  if(!name) return res.status(400).json({error:"name required"});

  if(String(req.query?.mode||"")==="resolve"){
    const result=await resolveZeriBasis(name);
    return res.status(200).json(result);
  }

  try{
    const search=await get(SEARCH(name));
    const links=extractWorkLinks(search.text);
    const currentNorm=norm(name);
    const associations=new Map();

    for(const url of links){
      let page;
      try{page=await get(url)}catch{continue}
      const text=stripHtml(page.text);
      const mainSection=section(text,"AUTORE",["ALTRE ATTRIBUZIONI","Datazione","DATAZIONE"]);
      const altSection=section(text,"ALTRE ATTRIBUZIONI",["Datazione","DATAZIONE","LOCALIZZAZIONI"]);
      const main=parseAuthors("Autore "+mainSection);
      const alt=parseAuthors(altSection);
      const all=[...new Set([...main,...alt])];

      const currentMatched=all.some(x=>{
        const nx=norm(x);
        return nx===currentNorm || nx.includes(currentNorm) || currentNorm.includes(nx);
      });
      if(!currentMatched) continue;

      for(const other of all){
        const no=norm(other);
        if(!no || no===currentNorm || no.includes(currentNorm) || currentNorm.includes(no)) continue;
        const key=no;
        if(!associations.has(key)){
          associations.set(key,{artist:other,works:[],count:0});
        }
        const item=associations.get(key);
        const work={title:titleFrom(page.text),url:page.url};
        if(!item.works.some(w=>w.url===work.url)){
          item.works.push(work);
          item.count++;
        }
      }
    }

    const results=[...associations.values()]
      .sort((a,b)=>b.count-a.count || a.artist.localeCompare(b.artist))
      .slice(0,12);

    return res.status(200).json({
      artist:name,
      source:"Fondazione Federico Zeri",
      search_url:SEARCH(name),
      works_checked:links.length,
      associations:results
    });
  }catch(e){
    return res.status(200).json({
      artist:name,source:"Fondazione Federico Zeri",search_url:SEARCH(name),
      works_checked:0,associations:[],warning:e.message
    });
  }
};

module.exports._test={stripHtml,norm,extractWorkLinks,parseAuthors,titleFrom,resolveZeriBasis};
