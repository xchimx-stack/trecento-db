import fs from 'node:fs';
const s=fs.readFileSync(new URL('../server/v1/network-admin.js',import.meta.url),'utf8');
const a=fs.readFileSync(new URL('../public/admin-v1.html',import.meta.url),'utf8');
const checks=[
 ['Wikimedia pacing',s.includes('WIKIMEDIA_MIN_INTERVAL_MS=800')&&s.includes('await wikimediaPace()')],
 ['Wikipedia maxlag',s.includes("maxlag:5")&&s.includes('retryAfterMs(r,attempt)')],
 ['sitelink accepted directly',s.includes("return resolvedKnownSitelink('en',enTitle")],
 ['local sitelink direct fallback',s.includes("return resolvedKnownSitelink(lang,localTitle")],
 ['media retry status',s.includes("resolved.media_retry?'retry'")&&s.includes("isoAfterMinutes(20)")],
 ['binary retry',s.includes('async function fetchWikimediaBinary')],
 ['admin retry visibility',a.includes('media retry due')]
];let bad=0;for(const [n,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${n}`);if(!ok)bad++}process.exit(bad?1:0);