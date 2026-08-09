(function(root,factory){
  const api=factory();
  if(typeof module!=="undefined"&&module.exports) module.exports=api;
  root.TrecentoPlacement=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  const REGION_RULES=[
    ["Veneto",["venice","venetian","venezia","veneziano","padua","padova","verona","veronese","vicenza"]],
    ["Bologna",["bologna","bolognese","modena","modenese","ferrara","emilia","faenza","forli","forlì","parma"]],
    ["Rimini",["rimini","riminese","marche","fabriano","ancona","urbino"]],
    ["Florence",["florence","florentine","firenze","fiorentino","tuscany","tuscan","arezzo","prato","pistoia","lucca"]],
    ["Siena",["siena","sienese","senese","san gimignano"]],
    ["Pisa",["pisa","pisan","pisano"]],
    ["Rome",["rome","roman","roma","romano","umbria","perugia","orvieto","viterbo","assisi"]],
    ["Naples",["naples","neapolitan","napoli","napoletano","campania"]]
  ];
  const esc=x=>String(x).replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const boundary=term=>new RegExp(`(?:^|[^\\p{L}])${esc(term)}(?:$|[^\\p{L}])`,`giu`);
  const count=(haystack,term)=>(String(haystack||"").match(boundary(term))||[]).length;
  const activityTemplates=term=>[
    new RegExp(`\\b(?:active|worked|working|based|born|died)\\s+(?:mainly\\s+|primarily\\s+|chiefly\\s+)?(?:in|at|around|near)\\s+(?:the\\s+)?${esc(term)}\\b`,`iu`),
    new RegExp(`\\b(?:painter|artist|master)\\s+(?:active|working|based)\\s+(?:in|at|around|near)\\s+(?:the\\s+)?${esc(term)}\\b`,`iu`)
  ];

  function inferRegion(text,name){
    const raw=String(text||"");
    const lead=raw.slice(0,1400).toLowerCase();
    const full=raw.toLowerCase();
    const nameText=String(name||"").toLowerCase();
    const scored=[];
    for(const [region,terms] of REGION_RULES){
      let score=0;const evidence=[];
      for(const term of terms){
        const n=count(nameText,term);if(n){score+=n*8;evidence.push(`name: ${term}`)}
        const l=count(lead,term);if(l){score+=Math.min(l,3)*4;evidence.push(`lead: ${term}`)}
        const f=count(full,term);if(f){score+=Math.min(f,5);evidence.push(`article: ${term}`)}
        if(activityTemplates(term).some(rx=>rx.test(lead))){score+=10;evidence.push(`activity: ${term}`)}
      }
      if(score>0) scored.push({region,score,evidence:[...new Set(evidence)]});
    }
    scored.sort((a,b)=>b.score-a.score);
    const best=scored[0],second=scored[1];
    if(!best) return {region:null,confidence:0,evidence:null,alternatives:[]};
    if(second && best.score-second.score<4){
      return {region:null,confidence:0,evidence:`Ambiguous: ${best.region} ${best.score} vs ${second.region} ${second.score}`,alternatives:scored.slice(0,3)};
    }
    const margin=second?best.score-second.score:best.score;
    const confidence=Math.min(.92,.58+Math.min(best.score,24)/100+Math.min(margin,12)/100);
    return {region:best.region,confidence,evidence:best.evidence.slice(0,4).join("; "),alternatives:scored.slice(0,3)};
  }

  return {inferRegion,REGION_RULES};
});
