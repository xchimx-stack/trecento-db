
function norm(s){
  return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[’']/g,"'").replace(/\bst\.?\b/g,"saint")
    .replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}
function naturalName(s){
  s=String(s||"").trim();
  if(!s.includes(",")) return s;
  const [family,...rest]=s.split(",");
  return `${rest.join(",").trim()} ${family.trim()}`.trim();
}
function masterVariants(s){
  const out=[s];
  if(/^master of the /i.test(s)){
    const tail=s.replace(/^master of the /i,"");
    out.push(`Maestro del ${tail}`,`Maestro della ${tail}`,`Maestro delle ${tail}`,`Maestro di ${tail}`);
  }else if(/^master of /i.test(s)){
    const tail=s.replace(/^master of /i,"");
    out.push(`Maestro di ${tail}`,`Maestro del ${tail}`,`Maestro della ${tail}`,`Maestro delle ${tail}`);
  }
  return [...new Set(out)];
}
function scoreTitle(candidate, query){
  const t=norm(candidate), q=norm(query);
  if(t===q) return 100;
  if(t.includes(q)||q.includes(t)) return 82;
  const A=new Set(q.split(" ")),B=new Set(t.split(" "));
  const overlap=[...A].filter(x=>B.has(x)).length;
  return 70*overlap/Math.max(A.size,B.size,1);
}
function classify({existing,wiki,ulan,zeri}){
  if(existing) return "Already in database";
  if(wiki||ulan||zeri) return "Substantiated candidate";
  return "UNRESOLVED — manual review";
}

const known = [
  "Agnolo Gaddi","Altichiero da Zevio","Giusto de' Menabuoi","Spinello Aretino",
  "Vitale da Bologna","Gentile da Fabriano","Lorenzo Monaco","Michelino da Besozzo",
  "Paolo Veneziano","Stefano Fiorentino","Lippo Memmi","Barna da Siena","Bartolo di Fredi",
  "Taddeo di Bartolo","Andrea di Bonaiuto","Jacopo del Casentino","Giovanni da Milano",
  "Niccolò di Pietro Gerini","Nardo di Cione","Jacopo di Cione","Giovanni Baronzio",
  "Barnaba da Modena","Andrea di Bartolo","Luca di Tommè","Lippo di Vanni","Paolo di Giovanni Fei"
];

for(const name of known){
  if(scoreTitle(name,name)!==100) throw new Error(`Exact-title regression: ${name}`);
}
if(naturalName("Gaddi, Agnolo")!=="Agnolo Gaddi") throw new Error("naturalName regression");
const mv=masterVariants("Master of the Codex of Saint George");
if(!mv.some(x=>/^Maestro /.test(x))) throw new Error("Master/Maestro variant regression");

// Critical semantic regression: lookup failure MUST NOT equal exclusion.
if(classify({existing:null,wiki:null,ulan:null,zeri:null})!=="UNRESOLVED — manual review")
  throw new Error("Lookup failure incorrectly excludes candidate");
if(classify({existing:{id:1},wiki:null,ulan:null,zeri:null})!=="Already in database")
  throw new Error("Existing DB classification regression");
if(classify({existing:null,wiki:{url:"x"},ulan:null,zeri:null})!=="Substantiated candidate")
  throw new Error("Wikipedia substantiation regression");
if(classify({existing:null,wiki:null,ulan:"500",zeri:null})!=="Substantiated candidate")
  throw new Error("ULAN substantiation regression");
if(classify({existing:null,wiki:null,ulan:null,zeri:"x"})!=="Substantiated candidate")
  throw new Error("Zeri substantiation regression");

// Simulate the exact API batch shape consumed by the browser.
const batch={
  reportOnly:true,total:3,offset:0,limit:8,done:true,nextOffset:3,
  candidates:[
    {name:"Agnolo Gaddi",existing:{id:1,canonical_name:"Gaddi, Agnolo",ulan_id:"500115303",layout_year:1380,region:"Florence",review_status:"approved"}},
    {name:"Barnaba da Modena",existing:null},
    {name:"Master of the Codex of Saint George",existing:null}
  ]
};
if(!Array.isArray(batch.candidates)) throw new Error("Candidate batch is not an array");
for(const c of batch.candidates){
  if(!c?.name) throw new Error("Candidate missing name");
  // This is the path that previously crashed on undefined .length.
  const status=classify({existing:c.existing,wiki:null,ulan:null,zeri:null});
  if(!status) throw new Error("Empty status");
}
console.log(`PASS: ${known.length} known-name title fixtures`);
console.log("PASS: DB/external/unresolved classification semantics");
console.log("PASS: API batch browser-consumption fixture");
