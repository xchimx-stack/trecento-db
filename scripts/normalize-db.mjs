import { createClient } from "@supabase/supabase-js";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY;
if(!url||!secret){console.error("Missing Supabase environment variables");process.exit(1)}
const supabase=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

const {data:artists,error}=await supabase.from("artists")
  .select("id,canonical_name,ulan_id,layout_year,region,review_status")
  .in("review_status",["imported_unreviewed"]);
if(error) throw error;

if(!artists?.length){console.log("DB normalization: no unreviewed rows; nothing to crawl.");process.exit(0)}
console.log(`DB normalization: ${artists.length} rows to normalize.`);

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function decodeHtml(s){return String(s||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g," ").trim()}
function deriveRegion(text){const t=text.toLowerCase();if(/\bvenetian\b|\bvenice\b|\bpadua\b|\bpaduan\b|\bpadova\b/.test(t))return"Veneto";if(/\bflorentine\b|\bflorence\b/.test(t))return"Florence";if(/\bsienese\b|\bsiena\b/.test(t))return"Siena";if(/\bbolognese\b|\bbologna\b/.test(t))return"Bologna";if(/\brimini\b|\briminese\b/.test(t))return"Rimini";if(/\brome\b|\broman\b/.test(t))return"Rome";if(/\bnaples\b|\bneapolitan\b/.test(t))return"Naples";if(/\bpisa\b|\bpisan\b/.test(t))return"Pisa";return null}
function deriveYear(text){const idx=text.indexOf("Record Type:");const section=idx>=0?text.slice(idx,idx+1700):text.slice(0,1700);const years=[...section.matchAll(/\b(12\d{2}|13\d{2}|14\d{2})\b/g)].map(m=>Number(m[1]));if(years.length>=2&&Math.abs(years[1]-years[0])<=180)return Math.round((years[0]+years[1])/2);if(years.length===1)return years[0];return null}

let ok=0,failed=0;
const updates=[];
for(let i=0;i<artists.length;i++){
  const a=artists[i];
  if(!a.ulan_id){updates.push({...a,review_status:"db_normalized_unresolved"});continue}
  try{
    const endpoint=`https://www.getty.edu/vow/ULANFullDisplay?find=&nation=&role=&subjectid=${a.ulan_id}`;
    const r=await fetch(endpoint,{headers:{"User-Agent":"TrecentoNetwork DB normalizer"}});
    if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const text=decodeHtml(await r.text());
    const year=deriveYear(text);
    const region=deriveRegion(text);
    updates.push({id:a.id,canonical_name:a.canonical_name,ulan_id:a.ulan_id,layout_year:year,region:region||a.region||null,review_status:"db_normalized"});
    ok++;
  }catch(e){
    updates.push({id:a.id,canonical_name:a.canonical_name,ulan_id:a.ulan_id,layout_year:a.layout_year,region:a.region,review_status:"db_normalized_unresolved"});
    failed++;
  }
  if(i%8===7) await sleep(120);
}
for(let i=0;i<updates.length;i+=50){
  const batch=updates.slice(i,i+50);
  const {error:e}=await supabase.from("artists").upsert(batch,{onConflict:"id"});
  if(e) throw e;
}
console.log(`DB normalization complete: ${ok} ULAN records parsed, ${failed} failed.`);
