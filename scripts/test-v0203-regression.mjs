import fs from "node:fs";
const pkg=JSON.parse(fs.readFileSync("package.json","utf8"));
if(pkg.version!=="0.20.3") throw new Error(`expected version 0.20.3, got ${pkg.version}`);
const index=fs.readFileSync("public/index.html","utf8");
if(!index.includes("function artistIncludedInSelectedTier")) throw new Error("tier-count helper missing");
const statusBlock=index.slice(index.indexOf("function updateViewStatus"),index.indexOf("function animateExpandedMode"));
if(!statusBlock.includes("artists.filter(artistIncludedInSelectedTier).length")) throw new Error("status badge still uses animation visibility for counts");
if(statusBlock.includes("artists.filter(artistVisibleInScope).length")) throw new Error("status badge can still report transitional Core count");
console.log("v0.20.3 regression: PASS");
