const CANDIDATES = [
"Giotto di Bondone","Duccio di Buoninsegna","Cimabue","Simone Martini","Ambrogio Lorenzetti","Pietro Lorenzetti",
"Pietro Cavallini","Maso di Banco","Bernardo Daddi","Taddeo Gaddi","Agnolo Gaddi","Altichiero da Zevio","Giusto de' Menabuoi",
"Spinello Aretino","Vitale da Bologna","Gentile da Fabriano","Lorenzo Monaco","Michelino da Besozzo","Paolo Veneziano","Stefano Fiorentino",
"Lippo Memmi","Barna da Siena","Bartolo di Fredi","Taddeo di Bartolo","Andrea di Bonaiuto","Jacopo del Casentino","Giovanni da Milano",
"Niccolò di Pietro Gerini","Nardo di Cione","Jacopo di Cione","Giovanni Baronzio","Barnaba da Modena","Andrea di Bartolo","Luca di Tommè",
"Lippo di Vanni","Paolo di Giovanni Fei","Naddo Ceccarelli","Cecco di Pietro","Jacopo di Mino del Pellicciaio","Andrea Vanni",
"Francesco di Vannuccio","Niccolò di Buonaccorso","Bartolomeo Bulgarini","Sano di Matteo","Giovanni d'Asciano","Martino di Bartolomeo",
"Pace di Bartolo","Giacomo di Mino","Giovanni di Paolo","Gregorio di Cecco","Priamo della Quercia","Antonio Veneziano","Jacopo d'Avanzi",
"Puccio Capanna","Giottino","Matteo Giovannetti","Simone dei Crocifissi","Simone da Cusighe","Ottaviano da Faenza","Stefano da Ferrara",
"Guglielmo da Forlì","Andrea da Bologna","Cristoforo da Bologna","Giovanni Bonsi","Lippo di Benivieni","Pacino di Buonaguida",
"Giovanni Bonini","Buonamico Buffalmacco","Montano d'Arezzo","Cristoforo di Bindoccio","Meo da Siena","Ugolino di Nerio",
"Segna di Bonaventura","Niccolò di Segna","Francesco di Segna","Giovanni di Bartolomeo Cristiani","Tommaso del Mazza","Tommaso da Modena",
"Guglielmo Veneziano","Catarino Veneziano","Donato Veneziano","Stefano da Verona","Pisanello","Anovelo da Imbonate","Cola Petruccioli",
"Ottaviano Nelli","Gherardo Starnina","Lorenzo di Bicci","Mariotto di Nardo","Bicci di Lorenzo","Rossello di Jacopo Franchi","Lippo d'Andrea",
"Battista di Biagio Sanguigni","Master of the Dominican Effigies","Master of the Orcagnesque Polyptychs","Master of the Corsi Crucifix",
"Master of the Straus Madonna","Master of Saint Cecilia","Master of Badia a Isola","Master of Città di Castello","Master of San Torpè",
"Master of the Assisi Choirbooks","Master of the Blue Crucifixes","Master of the Franciscan Crucifixes","Master of the Magdalen",
"Master of the Codex of Saint George","Master of the Bambino Vispo","Master of 1416","Master of Marradi","Master of Offida",
"Expressionist Master of Santa Chiara","Master of the Fogg Pietà","Master of 1310","Master of the Ovile Madonna","Master of Panzano",
"Master of Crevole","Master of the Palazzo Venezia","Master of the Ashmolean Predella","Master of San Quirico","Master of Tressa",
"Master of the Augustinian Legend","Master of the Life of Saint Benedict","Master of the Rinuccini Chapel","Master of Saint Verdiana",
"Master of the Osservanza","Master of 1338","Master of the San Giusto Altarpiece","Master of the Cesi Crucifix","Master of Tolentino",
"Master of the Trevi Triptych","Master of the Volterra Annunciation","Master of the Lucca Cross","Master of the Figline Polyptych",
"Master of the Arezzo Polyptych","Master of the Cortona Triptych","Master of the Gubbio Altarpiece"
];

const UA = 'TrecentoNetwork/0.14.1 candidate resolver';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fetchJson(url) {
  const r = await fetch(url, {headers:{accept:'application/json','user-agent':UA}});
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}
async function wikiSearch(name, lang) {
  const u = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(name)}&gsrnamespace=0&gsrlimit=5&prop=pageprops|info&inprop=url`;
  try {
    const j = await fetchJson(u);
    const pages = Object.values(j.query?.pages || {});
    const norm = s => (s||'').toLowerCase().replace(/[’']/g,"'").replace(/\bst\.?\b/g,'saint').replace(/[^a-z0-9]+/g,' ').trim();
    const target = norm(name);
    pages.sort((a,b) => {
      const sa = norm(a.title)===target ? 0 : (norm(a.title).includes(target)||target.includes(norm(a.title)) ? 1 : 2);
      const sb = norm(b.title)===target ? 0 : (norm(b.title).includes(target)||target.includes(norm(b.title)) ? 1 : 2);
      return sa-sb;
    });
    const p = pages[0];
    if (!p) return null;
    return {title:p.title,url:p.fullurl||`https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g,'_'))}`,qid:p.pageprops?.wikibase_item||null};
  } catch { return null; }
}
async function wikidataEntity(qid) {
  if (!qid) return null;
  try {
    const j=await fetchJson(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
    const e=j.entities?.[qid]; if(!e) return null;
    const claim=(p)=>e.claims?.[p]?.[0]?.mainsnak?.datavalue?.value;
    const time=(p)=>{const v=claim(p); return v?.time ? Number(v.time.slice(1,5)) : null};
    return {qid,ulan:claim('P245')||null,birth:time('P569'),death:time('P570')};
  } catch { return null; }
}
async function zeriSearch(name) {
  // Zeri is used only when a resolvable public search/result URL is found.
  // No artist is accepted merely because the name appeared in the seed list.
  const q=encodeURIComponent(name);
  const urls=[
    `https://catalogo.fondazionezeri.unibo.it/ricerca.v2.jsp?fulltext=${q}`,
    `https://fondazionezeri.unibo.it/it/ricerca?query=${q}`
  ];
  for (const url of urls) {
    try {
      const r=await fetch(url,{headers:{'user-agent':UA},redirect:'follow'});
      if(!r.ok) continue;
      const t=(await r.text()).toLowerCase();
      const tokens=name.toLowerCase().replace(/[^a-zà-ÿ0-9 ]/g,' ').split(/\s+/).filter(x=>x.length>3);
      if(tokens.length && tokens.filter(x=>t.includes(x)).length >= Math.min(2,tokens.length)) return r.url || url;
    } catch {}
  }
  return null;
}

module.exports = async function handler(req,res){
  try{
    const offset=Math.max(0,Number(req.query?.offset||0));
    const limit=Math.min(12,Math.max(1,Number(req.query?.limit||8)));
    const slice=CANDIDATES.slice(offset,offset+limit);
    const rows=[];
    for(const name of slice){
      const it=await wikiSearch(name,'it');
      const en=it ? null : await wikiSearch(name,'en');
      const wiki=it||en;
      const wd=await wikidataEntity(wiki?.qid);
      const zeri=(!wiki && !wd?.ulan) ? await zeriSearch(name) : null;
      const sources=[wd?.ulan?'ULAN':null,wiki?'Wikipedia':null,zeri?'Zeri':null].filter(Boolean);
      rows.push({
        name,
        wikipedia:wiki?.url||null,
        wikipediaLang:it?'it':(en?'en':null),
        qid:wiki?.qid||null,
        wikidata:wiki?.qid?`https://www.wikidata.org/wiki/${wiki.qid}`:null,
        ulan:wd?.ulan||null,
        ulanUrl:wd?.ulan?`https://www.getty.edu/vow/ULANFullDisplay?find=&role=&nation=&subjectid=${encodeURIComponent(wd.ulan)}`:null,
        zeri,
        birth:wd?.birth||null, death:wd?.death||null,
        sources,
        assessment:sources.length ? 'substantiated' : 'no basis — exclude'
      });
      await sleep(80);
    }
    res.status(200).json({reportOnly:true,total:CANDIDATES.length,offset,limit,done:offset+slice.length>=CANDIDATES.length,nextOffset:offset+slice.length,candidates:rows});
  }catch(e){res.status(500).json({error:e.message||String(e)})}
};