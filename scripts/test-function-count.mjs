import fs from "node:fs";
import path from "node:path";
const api=path.resolve("api");
const files=fs.readdirSync(api).filter(x=>/\.(js|mjs|ts)$/.test(x)).sort();
console.log(`API function files: ${files.length}`);
for(const f of files) console.log(` - ${f}`);
if(files.length>8) throw new Error(`API consolidation regression: ${files.length} functions; target is <= 8`);
const expected=["artists.js","authorities.js","discovery.js","graph.js","wikipedia.js"];
for(const f of expected) if(!files.includes(f)) throw new Error(`Missing consolidated API router: ${f}`);
const legacy=[
  "admin-override.js","admit-candidate.js","artist-media.js","cache-artist-media.js",
  "discover-trecento.js","discovery-admit.js","discovery-data.js","ulan-resolve.js",
  "wiki-crawl-data.js","wiki-relationship-candidates.js","zeri-connections.js"
];
for(const f of legacy) if(files.includes(f)) throw new Error(`Legacy API function still deployed: ${f}`);
console.log("PASS: API consolidated with Hobby-plan headroom");
