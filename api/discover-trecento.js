module.exports = async function handler(req, res) {
  try {
    const query = `
SELECT DISTINCT ?item ?itemLabel ?birth ?death ?occupationLabel ?placeLabel ?ulan ?article WHERE {
  VALUES ?occupation { wd:Q1028181 wd:Q644687 wd:Q15296811 }
  ?item wdt:P106 ?occupation.
  OPTIONAL { ?item wdt:P569 ?birth. }
  OPTIONAL { ?item wdt:P570 ?death. }
  OPTIONAL { ?item wdt:P937 ?place. }
  OPTIONAL { ?item wdt:P19 ?place. }
  OPTIONAL { ?item wdt:P245 ?ulan. }
  OPTIONAL {
    ?article schema:about ?item; schema:isPartOf <https://it.wikipedia.org/>.
  }
  FILTER(
    (!BOUND(?birth) || YEAR(?birth) <= 1420) &&
    (!BOUND(?death) || YEAR(?death) >= 1270) &&
    (BOUND(?birth) || BOUND(?death))
  )
  SERVICE wikibase:label { bd:serviceParam wikibase:language "it,en". }
}
LIMIT 500`;
    const url='https://query.wikidata.org/sparql?format=json&query='+encodeURIComponent(query);
    const r=await fetch(url,{headers:{'accept':'application/sparql-results+json','user-agent':'TrecentoNetwork/0.14 discovery report'}});
    if(!r.ok) throw new Error('Wikidata query failed: '+r.status);
    const j=await r.json();
    const byId=new Map();
    for(const row of j.results.bindings){
      const qid=(row.item?.value||'').split('/').pop(); if(!qid) continue;
      const cur=byId.get(qid)||{qid,name:row.itemLabel?.value||qid,birth:row.birth?.value||null,death:row.death?.value||null,occupations:new Set(),places:new Set(),ulan:row.ulan?.value||null,wikipedia:row.article?.value||null};
      if(row.occupationLabel?.value) cur.occupations.add(row.occupationLabel.value);
      if(row.placeLabel?.value) cur.places.add(row.placeLabel.value);
      cur.ulan=cur.ulan||row.ulan?.value||null; cur.wikipedia=cur.wikipedia||row.article?.value||null; byId.set(qid,cur);
    }
    const yr=v=>v?new Date(v).getUTCFullYear():null;
    const candidates=[...byId.values()].map(x=>{
      const b=yr(x.birth),d=yr(x.death), place=[...x.places].join('; ');
      const identitySignals=(x.ulan?1:0)+(x.wikipedia?1:0);
      return {qid:x.qid,name:x.name,dates:[b,d].filter(Boolean).join('–')||'unknown',occupation:[...x.occupations].join('; '),place,
        ulan:x.ulan,wikipedia:x.wikipedia,wikidata:'https://www.wikidata.org/wiki/'+x.qid,
        assessment:(identitySignals>=2 && place)?'credible':(identitySignals>=1?'review':'weak')};
    });
    res.status(200).json({reportOnly:true,window:'1270–1420',candidates});
  } catch(e){ res.status(500).json({error:e.message||String(e)}); }
};