import fs from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {inferRegion}=require("../public/discovery-placement.js");
const index=fs.readFileSync("public/discover.html","utf8");
const pkg=JSON.parse(fs.readFileSync("package.json","utf8"));
const need=(s,x,l)=>{if(!s.includes(x))throw new Error(`${l}: missing ${x}`)};

if(!/^0\.(19\.[1-9]|[2-9][0-9]\.)/.test(pkg.version)) throw new Error(`package version ${pkg.version} predates 0.19.1`);
need(index,'<script src="/discovery-placement.js"></script>',"shared placement scorer loaded");
need(index,'Needs region — ambiguous evidence',"ambiguous placement hold");
need(index,'region_evidence:regionInfo.evidence||null',"region evidence retained in candidate payload");

const fixtures=[
  ["Master of 1302","The Master of 1302 was an Italian painter active in Emilia in the first half of the 14th century. His works include frescos in Parma and later comparisons with Lombard art in Como.","Bologna"],
  ["Master of 1310","The Master of 1310 was an Italian painter active in Pistoia at the end of the 13th into the beginning of the fourteenth century. His painting shows French Gothic influence.","Florence"],
  ["Barna da Siena","Barna da Siena was a Sienese painter. Later writers compared his work with Florentine painting and works in Florence.","Siena"],
  ["Paolo Veneziano","Paolo Veneziano was a Venetian painter active in Venice. His work was influential in Florence and Bologna.","Veneto"]
];
for(const [name,text,want] of fixtures){
  const got=inferRegion(text,name);
  if(got.region!==want) throw new Error(`${name}: wanted ${want}, got ${got.region}; ${got.evidence}`);
}
const ambiguous=inferRegion("The painter was active in Siena and later active in Florence.","Anonymous painter");
if(ambiguous.region!==null || !String(ambiguous.evidence).startsWith("Ambiguous:")) throw new Error("mixed-school ambiguity should be held");
console.log("PASS: v0.19.1 evidence-weighted Trecento region placement");
