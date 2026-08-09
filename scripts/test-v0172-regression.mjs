import fs from "node:fs";
const edit=fs.readFileSync("public/admin-edit.html","utf8");
const index=fs.readFileSync("public/index.html","utf8");
const need=(s,x,l)=>{if(!s.includes(x))throw new Error(`${l}: missing ${x}`)};
need(edit,"relPreview","relationship identity preview");
need(edit,"Open/refresh network","network refresh button");
need(index,"scheduleRender","RAF render throttle");
console.log("PASS: retained v0.17.2 regression contract");
