import fs from "node:fs";
const index=fs.readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
const discover=fs.readFileSync(new URL("../public/discover.html",import.meta.url),"utf8");
const zeri=fs.readFileSync(new URL("../server/handlers/zeri-connections.js",import.meta.url),"utf8");
const admit=fs.readFileSync(new URL("../server/handlers/admit-candidate.js",import.meta.url),"utf8");
const graph=fs.readFileSync(new URL("../api/graph.js",import.meta.url),"utf8");
function need(s,x,label){if(!s.includes(x)) throw new Error(`${label}: missing ${x}`)}
function forbid(s,x,label){if(s.includes(x)) throw new Error(`${label}: forbidden ${x}`)}

// Mobile map: viewport units, touch pan/pinch, explicit zoom controls, no full-world viewBox.
need(index,"syncCanvasViewBox","viewport-coordinate SVG");
need(index,"touchPointers:new Map()","touch pointer state");
need(index,"pointerdown","touch pan");
need(index,"state.pinch","pinch zoom");
need(index,'id="zoomInBtn"',"mobile zoom in");
need(index,'id="resetViewBtn"',"mobile reset view");
need(index,"A phone is a window onto the map","no mobile fit-all policy");
forbid(index,'canvas.setAttribute("viewBox",`0 0 ${graphWorldWidth} ${graphWorldHeight}`)',"desktop-world viewBox regression");

// Node click does not recenter; selection nudge exists.
need(index,"animateSelectionNudge","selection animation");
need(index,"maxPush=18*state.selectionProgress","elastic neighbor nudge");
need(index,"selectedBoost","selected node growth");
forbid(index,"function selectArtist(id, center=false)","legacy recentering selectArtist");
need(index,"if(!isMobileViewport()) requestAnimationFrame","search-only desktop jump");

// Zeri: scoped author field + strict authority + 3/5/7 thresholds.
need(zeri,"autore_OA","Zeri author field");
forbid(zeri,"fulltext=","Zeri free-text search");
need(index,"if(degree>=25) return 7","Zeri degree >=25 threshold");
need(index,"if(degree>=12) return 5","Zeri degree >=12 threshold");
need(index,"return 3","Zeri base threshold");
need(zeri,"no_authority_match","strict Zeri authority status");
need(zeri,"viafFromWikidata","VIAF crosswalk");

// Wikipedia: cache identity verification + full-text/category enrichment.
need(index,"validateCachedWikipedia","bad cache repair");
need(index,"wikipediaIdentityCompatible","authority-aware Wikipedia match");
need(index,"Wikidata","Wikipedia/Wikidata identity basis");
need(index,"enrichUnmappedPlacementsFromWikipedia","unmapped enrichment pass");
need(index,"emilia|emilian|emiliano|emiliana","Emilia region inference");
need(discover,'prop:"extracts|pageprops|info|categories"',"full discovery categories");
forbid(discover,'exintro:"1"',"discovery intro-only parsing");

// VIAF persisted and name-only duplicates never auto-merge.
need(admit,'source:"VIAF"',"VIAF persistence");
need(admit,"Name-only identity collision requires authority/manual review","same-name safeguard");
need(graph,"viaf_id","VIAF graph exposure");

// Proposed identity is a low-risk dotted semantic type, not a separate line language.
need(graph,'r.relationship_type==="proposed identity"',"proposed identity drawer meaning");

console.log("PASS: v0.16 mobile/Zeri/Wikipedia/VIAF/interaction regression contract");
