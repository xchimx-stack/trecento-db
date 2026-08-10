import fs from 'node:fs';
const d=fs.readFileSync('public/discover.html','utf8');
function need(x,m){if(!d.includes(x)) throw new Error(m)}
need('claimYear(entity,"P1317")','Wikidata floruit start');
need('claimYear(entity,"P1318")','Wikidata floruit end');
need('descriptions|sitelinks','Wikidata descriptions');
need('Year/date article, not an artist','year-page rejection');
console.log('v0.20.4 regression passed');
