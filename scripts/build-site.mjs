import fs from "node:fs/promises";
import { spawn } from "node:child_process";

function runNode(script){
  return new Promise((resolve,reject)=>{
    const p=spawn(process.execPath,[script],{stdio:"inherit"});
    p.on("exit",code=>code===0?resolve():reject(new Error(`Importer exited ${code}`)));
  });
}

const imported = new URL("../data/imported-artists.json", import.meta.url);
const status = new URL("../data/crawl-status.json", import.meta.url);
const publicImported = new URL("../public/imported-artists.json", import.meta.url);
const publicStatus = new URL("../public/crawl-status.json", import.meta.url);

try{
  await runNode(new URL("./import-ulan.mjs", import.meta.url).pathname);
}catch(e){
  console.warn("ULAN importer failed; site will still deploy:", e.message);
}

try{ await fs.copyFile(imported, publicImported); }
catch{
  const seed=JSON.parse(await fs.readFile(new URL("../data/seed-artists.json", import.meta.url),"utf8"));
  await fs.writeFile(publicImported,JSON.stringify({
    generated_at:null,
    source:"seed fallback",
    count:seed.artists.length,
    artists:seed.artists.map(x=>({
      seed_name:x.seed_name,
      canonical_name:x.seed_name,
      ulan:{id:null,uri:null,candidates:[]},
      review_status:"seed"
    }))
  },null,2));
}

try{ await fs.copyFile(status, publicStatus); }
catch{
  await fs.writeFile(publicStatus,JSON.stringify({
    source:"Getty ULAN",
    fatal_error:"No crawl-status file was produced during build."
  },null,2));
}

await fs.access(new URL("../public/index.html", import.meta.url));
console.log("Trecento Network v0.5 ULAN-only proof-of-concept ready.");
