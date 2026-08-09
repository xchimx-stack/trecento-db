import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const publicFiles=fs.readdirSync(path.join(root,"public")).filter(x=>x.endsWith(".html"));
const publicText=publicFiles.map(f=>fs.readFileSync(path.join(root,"public",f),"utf8")).join("\n");

const required=[
  "/api/artists?action=override",
  "/api/artists?action=media",
  "/api/artists?action=cache-media",
  "/api/artists?action=admit",
  "/api/discovery?action=finite",
  "/api/discovery?action=data",
  "/api/discovery?action=admit",
  "/api/wikipedia?action=crawl-data",
  "/api/wikipedia?action=relationship-candidates",
  "/api/authorities?action=ulan",
  "/api/authorities?action=zeri",
  "/api/graph"
];
for(const ref of required){
  if(!publicText.includes(ref)) throw new Error(`Missing consolidated endpoint reference: ${ref}`);
}

const forbidden=[
  "/api/admin-override","/api/admit-candidate","/api/artist-media","/api/cache-artist-media",
  "/api/discover-trecento","/api/discovery-data","/api/discovery-admit","/api/ulan-resolve",
  "/api/wiki-crawl-data","/api/wiki-relationship-candidates","/api/zeri-connections"
];
for(const ref of forbidden){
  if(publicText.includes(ref)) throw new Error(`Stale legacy endpoint reference: ${ref}`);
}

const routerExpectations={
  "artists.js":["override","media","cache-media","admit"],
  "discovery.js":["finite","data","admit"],
  "wikipedia.js":["crawl-data","relationship-candidates"],
  "authorities.js":["ulan","zeri"]
};
for(const [file,actions] of Object.entries(routerExpectations)){
  const txt=fs.readFileSync(path.join(root,"api",file),"utf8");
  for(const action of actions){
    if(!txt.includes(`"${action}"`)) throw new Error(`${file} missing action ${action}`);
  }
}

console.log("PASS: consolidated API routers and frontend references");
