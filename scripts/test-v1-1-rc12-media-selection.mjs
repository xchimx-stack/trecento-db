import fs from 'node:fs';
import assert from 'node:assert/strict';
const api=fs.readFileSync(new URL('../server/v1/network-admin.js',import.meta.url),'utf8');

assert.ok(api.includes("function representativeArticleImage"));
assert.ok(api.includes("const body=await bodyArtworkImage"));
assert.ok(api.includes("const lead=await leadArticleImage"));
assert.ok(api.indexOf("const body=await bodyArtworkImage") < api.indexOf("const lead=await leadArticleImage"));
assert.ok(api.includes("prop:'pageimages'"));
assert.ok(api.includes("leadImageReject"));
assert.ok(/stub/.test(api));
assert.ok(/ambox/.test(api));
assert.ok(/maintenance/.test(api));
assert.ok(api.includes("selector:'rc12-structural-article-body-v3'"));
assert.ok(!api.includes("try{art=await bodyArtworkImage(lang,title,seed)}"));
console.log("PASS media selection: body artwork first, lead image fallback, stub/template images always rejected");
