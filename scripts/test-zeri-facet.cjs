const z=require("../server/handlers/zeri-connections.js")._test;
const u=z.scopedSearchUrl("Nardo di Cione",1,100);
if(!u.includes("AUTN_AUTP_AAT_ROFA_ATBD=Nardo+di+Cione")) throw new Error("Wrong Zeri scoped field or space encoding: "+u);
if(u.includes("autore_OA=")||u.includes("fulltext=")) throw new Error("Broad/old Zeri search field remains");
const fixture=`<div>ARTIST Nardo di Cione (185)</div><div>OTHER ATTRIBUTIONS
Giotto di Bondone 167 Giotto di Maestro Stefano (Giottino) 36 Parente di Giotto 18
Stefano Fiorentino 17 Maestro della cappella di San Nicola 13 Cavallini Pietro 6
LOCATION Florence 50</div>`;
const rows=z.extractOtherAttributionsFacet(fixture);
const giotto=rows.find(x=>x.artist.includes("Giotto di Bondone"));
if(!giotto||giotto.count!==167) throw new Error("Facet parser failed Giotto fixture: "+JSON.stringify(rows));
console.log("PASS: exact Zeri facet URL + OTHER ATTRIBUTIONS parser fixture");
