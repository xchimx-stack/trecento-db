import fs from 'node:fs';
const index=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../server/v1/network-admin.js',import.meta.url),'utf8');
const vercel=JSON.parse(fs.readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
const checks=[
 ['generic viewer is index',index.includes("/api/v1?action=list-networks")&&index.includes("/api/v1?action=graph&network=")],
 ['network selector',index.includes('id="networkSelect"')&&index.includes('Select network')],
 ['generic Admin canonical',admin.includes('Art Network Administration')&&admin.includes('Add network')&&admin.includes('Generate Expanded from Core')],
 ['tier hierarchy defined',index.includes("const base=a.networkTier==='core'?40:a.networkTier==='expanded'?31:24")],
 ['tier hierarchy rendered',index.includes("const radius=baseNodeRadius(a);")],
 ['adaptive density spacing',index.includes("const spacingScale=Math.max(.88,Math.min(1.30")],
 ['background chronology removed',!index.includes('const tickYears=')&&!index.includes('subtle chronology ticks')],
 ['current snapshot version',api.includes("build_version:'1.1-rc12'")],
 ['old viewer redirects',vercel.redirects?.some(x=>x.source==='/v1.html'&&x.destination==='/')],
 ['old admin redirects',vercel.redirects?.some(x=>x.source==='/admin-v1.html'&&x.destination==='/admin.html')],
 ['old discovery redirects',vercel.redirects?.some(x=>x.source==='/discover.html'&&x.destination==='/admin.html')],
 ['media throttle retained',api.includes("r.status===429||r.status===503")&&api.includes("retryAfterMs")],
 ['exact P245 retained',api.includes("wikidataClaimValues(e,'P245').includes(id)")],
];
let bad=0;for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${name}`);if(!ok)bad++}process.exit(bad?1:0);
