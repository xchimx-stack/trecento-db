import fs from "node:fs";

const index=fs.readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
const discover=fs.readFileSync(new URL("../public/discover.html",import.meta.url),"utf8");
const graph=fs.readFileSync(new URL("../api/graph.js",import.meta.url),"utf8");
const admit=fs.readFileSync(new URL("../server/handlers/admit-candidate.js",import.meta.url),"utf8");
const zeri=fs.readFileSync(new URL("../server/handlers/zeri-connections.js",import.meta.url),"utf8");

function requireText(haystack,needle,label){
  if(!haystack.includes(needle)) throw new Error(`${label}: missing ${needle}`);
}
function forbid(haystack,needle,label){
  if(haystack.includes(needle)) throw new Error(`${label}: forbidden ${needle}`);
}

// Default source state.
requireText(index,'value="ULAN" checked',"ULAN default");
forbid(index,'value="Wikipedia" checked',"Wikipedia default");
requireText(index,"Wikipedia:false","Wikipedia runtime default");

// Zeri drawer + Core-only guard.
requireText(index,"Zeri connoisseurial associations","Zeri drawer");
requireText(index,'a.networkTier!=="core"',"Core-only Zeri guard");
requireText(index,'action:"zeri"',"Zeri endpoint call");
requireText(discover,"/api/authorities?action=zeri&mode=resolve","Consolidated Zeri discovery resolver");
forbid(discover,"/api/zeri-resolve","Removed Zeri resolver endpoint");

// Mobile relationship-key drawer.
requireText(index,'id="relationshipKeyBtn"',"mobile relationship key button");
requireText(index,"#legend.open","mobile legend open state");
requireText(index,"max-width:calc(100vw - 16px)","mobile drawer width");

// Discovery completion and admission.
requireText(discover,'id="completion"',"completion note");
requireText(discover,'id="admitReady"',"admission button");
requireText(discover,"resolvedCandidates","admission candidate state");
requireText(discover,"Ready for Expanded","placement count");
requireText(discover,'data-label="Name"',"mobile table/card labels");

// Admission safety contract.
requireText(admit,"At least one external basis is required","basis gate");
requireText(admit,"A defensible mapped region is required","region gate");
requireText(admit,"duplicate_review","duplicate hold");
requireText(admit,'network_tier:"expanded"',"expanded admission result");

// Zeri parser contract.
requireText(zeri,"autore_OA","Zeri scoped author/attribution search");
requireText(zeri,"works_checked","Zeri response metadata");

// Merged records hidden in graph.
requireText(graph,"!a.merged_into_artist_id","merged record filter");

console.log("PASS: v0.15 UI/admission/Zeri/mobile regression contract");
