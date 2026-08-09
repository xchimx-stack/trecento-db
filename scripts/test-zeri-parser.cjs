const z=require("../server/handlers/zeri-connections.js")._test;
const search=z.scopedSearchUrl("Mariotto di Nardo",1,100);
if(!search.includes("autore_OA=Mariotto+di+Nardo")) throw new Error("Zeri search is not scoped to author/attribution field");
if(search.includes("fulltext=")) throw new Error("Zeri search fell back to free text");
const html=`
<div><a href="/scheda/opera/4216/Pseudo-Ambrose%20of%20Baldese%2C%20Madonna%20and%20Child">work</a></div>
<div><a href="/scheda/opera/3943/Mariotto%20di%20Nardo%2C%20Madonna%20con%20Bambino">work</a></div>
<span>page 1 of 2</span>`;
const links=z.extractWorkLinks(html);
if(links.length!==2) throw new Error(`Expected 2 work links, got ${links.length}`);
if(z.authorFromWorkUrl(links[0])!=="Pseudo-Ambrose of Baldese") throw new Error("Failed to derive catalogued author from Zeri work URL");
if(z.extractTotalPages(html)!==2) throw new Error("Failed to parse Zeri page count");
const authority=`<div>AUTORE</div><div>Autore Mariotto di Nardo <a href="https://www.getty.edu/vow/ULANFullDisplay?subjectid=500115555">ULAN</a> <a href="https://viaf.org/viaf/12345678/">VIAF</a> Motivazione dell'attribuzione Bibliografia</div><div>ALTRE ATTRIBUZIONI</div><div>Autore Pseudo-Ambrose <a href="https://www.getty.edu/vow/ULANFullDisplay?subjectid=500999999">ULAN</a> Motivazione dell'attribuzione</div>`;
const ids=z.extractNamedAuthorityIds(authority,"Mariotto di Nardo");
if(ids.ulan[0]!=="500115555"||ids.viaf[0]!=="12345678") throw new Error("Authority ID parsing failed");
if(!z.authorityMatch(ids,"500115555",null).matched) throw new Error("ULAN authority match failed");
console.log("PASS: Zeri scoped-search + authority fixture");
