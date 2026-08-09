import fs from "node:fs";
import vm from "node:vm";
const pkg=JSON.parse(fs.readFileSync("package.json","utf8"));
if(pkg.version!=="0.20.1") throw new Error(`expected version 0.20.1, got ${pkg.version}`);
const handlerSource=fs.readFileSync("server/handlers/discover-trecento.js","utf8");
if(handlerSource.includes("module.exports.zeriSearch=zeriSearch")) throw new Error("stale undefined zeriSearch export remains");
// Execute module initialization with Supabase mocked; this catches undefined symbols at require-time.
const context={module:{exports:{}},exports:{},require:(id)=>{if(id==="@supabase/supabase-js")return {createClient:()=>({})};throw new Error(`unexpected require ${id}`)},console,process:{env:{}}};
vm.runInNewContext(handlerSource,context,{filename:"discover-trecento.js"});
if(typeof context.module.exports!=="function") throw new Error("discover-trecento did not initialize as a handler");
const html=fs.readFileSync("public/discover.html","utf8");
if(!html.includes("non-JSON response")) throw new Error("discovery page lacks non-JSON API error handling");
console.log("v0.20.1 regression: PASS");
