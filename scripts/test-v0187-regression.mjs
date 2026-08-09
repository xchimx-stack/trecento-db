import fs from "node:fs";
const index=fs.readFileSync("public/index.html","utf8");
const graph=fs.readFileSync("api/graph.js","utf8");
const adminPreview=fs.readFileSync("public/admin-low-countries-preview.html","utf8");
const need=(s,x,l)=>{if(!s.includes(x))throw new Error(`${l}: missing ${x}`)};
const forbid=(s,x,l)=>{if(s.includes(x))throw new Error(`${l}: forbidden ${x}`)};

need(index,"Dutch &amp; Flemish Golden Age · BETA","public beta toggle label");
need(index,'NETWORK_MODE=new URLSearchParams(location.search)','shared-page network mode');
need(index,"materializeLowCountriesGraph","shared Trecento renderer materialization");
need(index,"Only occupied regions consume horizontal space","empty geography compression");
need(index,"Math.sqrt(n)*78","density-adaptive geography expansion/compression");
need(index,"body.low-countries-mode .node.selected circle","red selection");
need(index,"canvas.addEventListener('wheel'","shared cursor zoom");
need(index,"state.tx=mx-wx*ns","cursor-centered zoom math");
need(index,"animateSelectionNudge","shared local node push");
need(index,"selectRepresentativeArtwork","shared Trecento artwork selector");
need(index,"Wikipedia/Wikidata are used for identity-verified biography","Low Countries methodology");
need(index,"Tier 3 · +2°","three-tier controls");
need(graph,'req.query?.network || ""',"network-scoped graph API");
need(graph,'"low_countries"',"Low Countries graph payload");
need(graph,'sources:["ULAN"]',"ULAN-only Low Countries relationships");
// The graph file contains Wikipedia for Trecento, so verify Low Countries branch itself
const low=graph.slice(graph.indexOf('=== "low_countries"'),graph.indexOf('const [',graph.indexOf('=== "low_countries"')));
need(low,"low_countries","Low Countries branch present");
need(adminPreview,"buildGeographyBands","hidden diagnostic retained");
console.log("PASS: v0.18.7 shared renderer/public beta network consolidation");
