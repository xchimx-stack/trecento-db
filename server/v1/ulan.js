const crypto=require('crypto');
const RECONCILE='https://services.getty.edu/vocab/reconcile/';
const PAGE=id=>`https://www.getty.edu/vow/ULANFullDisplay?find=&nation=&role=&subjectid=${id}`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function request(url,options={},attempt=0){
  const r=await fetch(url,{...options,headers:{'User-Agent':'ArtNetworkEngine/1.0-alpha ULAN sync',...(options.headers||{})}});
  if((r.status===429||r.status===503)&&attempt<4){
    const retry=Number(r.headers.get('retry-after')||0);
    await sleep(Math.max(retry*1000,650*Math.pow(2,attempt)));
    return request(url,options,attempt+1);
  }
  if(!r.ok) throw new Error(`Getty ULAN ${r.status} ${r.statusText}`);
  return r;
}
function decodeHtml(s){
  return String(s||'')
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<(?:br|\/p|\/div|\/tr|\/li|\/h\d)>/gi,'\n')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
    .replace(/&ndash;|&#8211;/gi,'–').replace(/&mdash;|&#8212;/gi,'—')
    .replace(/[ \t]+/g,' ').replace(/\n\s+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
function clean(s){return String(s||'').replace(/\s+/g,' ').trim()}
function extractSection(text,label,nextLabels){
  const i=text.search(new RegExp(`${label}:`,'i')); if(i<0)return '';
  let s=text.slice(i+label.length+1),end=s.length;
  for(const n of nextLabels){const j=s.search(new RegExp(`${n}:`,'i'));if(j>=0&&j<end)end=j}
  return s.slice(0,end).trim();
}
function parseIdentity(text){
  const recordType=clean(text.match(/Record Type:\s*([A-Za-z ]+?)(?=\s+[A-Z][^:]{0,50}:|\s+\()/i)?.[1]);
  const names=extractSection(text,'Names',['Nationalities','Roles','Gender','Birth and Death Places','Events','Related People or Corporate Bodies']);
  let preferred=null; const aliases=[];
  const rx=/([A-ZÀ-ÖØ-öø-ÿ][^()\n]{1,180}?)\s*\(([^)]*)\)/g;
  for(const m of names.matchAll(rx)){
    const name=clean(m[1].replace(/^Names:\s*/i,'').replace(/\.{2,}/g,' '));
    if(!name||name.length>140)continue;
    const flags=String(m[2]||'').toLowerCase();
    if(flags.includes('preferred')&&!preferred)preferred=name;
    if(!aliases.includes(name))aliases.push(name);
  }
  return {record_type:recordType||null,preferred_name:preferred||aliases[0]||null,aliases};
}
function parseRoles(text){
  const raw=extractSection(text,'Roles',['Gender','Birth and Death Places','Events','Related People or Corporate Bodies','List/Hierarchical Position','Biographies']);
  const roles=[];
  for(const part of raw.split(/(?=\bImage\b)|\n|;/)){
    let r=clean(part.replace(/^Image\s+/i,'').replace(/\s*\((?:preferred|alternate|variant)[^)]*\)\s*$/i,''));
    if(!r||r.length>100)continue;
    if(/^preferred$/i.test(r))continue;
    if(!roles.includes(r))roles.push(r);
  }
  if(!roles.length&&raw){
    const tokens=raw.replace(/\bImage\b/gi,' ').split(/\s{2,}|,/).map(clean).filter(x=>x&&x.length<80);
    for(const r of tokens)if(!roles.includes(r))roles.push(r);
  }
  return {raw:clean(raw)||null,roles};
}
function parseNationalities(text){
  const raw=extractSection(text,'Nationalities',['Roles','Gender','Birth and Death Places','Events','Related People or Corporate Bodies']);
  return clean(raw.replace(/\bImage\b/gi,' '))||null;
}
function parsePlaces(text){
  const bd=extractSection(text,'Birth and Death Places',['Events','Related People or Corporate Bodies','List/Hierarchical Position','Biographies']);
  const birth=clean(bd.match(/\bBorn:\s*([\s\S]*?)(?=\bDied:|$)/i)?.[1]);
  const death=clean(bd.match(/\bDied:\s*([\s\S]*?)$/i)?.[1]);
  const events=extractSection(text,'Events',['Related People or Corporate Bodies','List/Hierarchical Position','Biographies']);
  const active=[];
  const rx=/\b(?:active|worked|lived|resided):\s*([^\n]+?)(?=(?:\bactive|\bworked|\blived|\bresided):|$)/gi;
  for(const m of events.matchAll(rx)){const v=clean(m[1]);if(v&&!active.includes(v))active.push(v)}
  return {birth_place:birth||null,death_place:death||null,active_places:active};
}
function parseDates(text){
  const bio=extractSection(text,'Biographies',['Additional Names','Sources and Contributors']);
  const source=bio||text.slice(0,3500);
  const years=[...source.matchAll(/(?<!\d)(1[0-9]{3}|20[0-9]{2})(?!\d)/g)].map(m=>Number(m[1])).filter(y=>y>=1000&&y<=2100);
  const uniq=[...new Set(years)];
  let start=uniq[0]||null,end=uniq[1]||uniq[0]||null;
  if(start&&end&&end<start)[start,end]=[end,start];
  if(start&&end&&end-start>180)end=null;
  return {period_start:start,period_end:end};
}
function parseRelationships(text,focusUlan){
  const section=extractSection(text,'Related People or Corporate Bodies',['List/Hierarchical Position','Biographies','Additional Names','Sources and Contributors']);
  if(!section)return [];
  const out=[],seen=new Set();
  // Getty display uses dotted leaders after the qualifier and commonly again
  // before the biography. Capture the raw qualifier rather than assuming a
  // fixed vocabulary; unknown qualifiers are quarantined later by the rules DB.
  const rx=/(?:^|\s)([A-Za-z][A-Za-z0-9 /()'’\-]{1,70}?)\s*\.{2,}\s*([\s\S]{1,420}?)\s*\[(5\d{8})\]/g;
  for(const m of section.matchAll(rx)){
    let qualifier=clean(m[1]).toLowerCase();
    let body=clean(m[2]); const related_ulan=m[3];
    qualifier=qualifier.replace(/^related people or corporate bodies:\s*/,'');
    if(!qualifier||qualifier.length>70||related_ulan===String(focusUlan))continue;
    let label=body.replace(/\s*\.{2,}\s*\([^)]*\)\s*$/,' ').replace(/\s+\([^)]*\)\s*$/,' ').replace(/\.{2,}/g,' ');
    label=clean(label);
    // Trim obvious relationship display-date suffixes without losing the raw text.
    const key=`${qualifier}|${related_ulan}`; if(seen.has(key))continue;seen.add(key);
    out.push({focus_ulan:String(focusUlan),related_ulan,raw_qualifier:qualifier,related_label:label||null,raw_context:body.slice(0,600)});
  }
  return out;
}
async function fetchProfile(ulanId){
  if(!/^5\d{8}$/.test(String(ulanId||'')))throw new Error('Invalid ULAN ID');
  const r=await request(PAGE(ulanId)); const html=await r.text(); const text=decodeHtml(html);
  const identity=parseIdentity(text),roles=parseRoles(text),dates=parseDates(text),places=parsePlaces(text);
  const profile={ulan_id:String(ulanId),source_url:PAGE(ulanId),...identity,...roles,nationalities:parseNationalities(text),...dates,...places,relationships:parseRelationships(text,ulanId)};
  profile.source_hash=crypto.createHash('sha256').update(JSON.stringify(profile)).digest('hex');
  return profile;
}
async function reconcileName(name){
  const body=new URLSearchParams();body.set('queries',JSON.stringify({q0:{query:String(name||'').trim(),type:'/ulan'}}));
  const r=await request(RECONCILE,{method:'POST',headers:{'Accept':'application/json','Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body});
  const d=await r.json();
  return (d?.q0?.result||[]).map(x=>({ulan_id:String(x.id||'').split('/').pop(),name:x.name||null,score:Number(x.score)||0,match:Boolean(x.match)})).filter(x=>/^5\d{8}$/.test(x.ulan_id)).slice(0,8);
}
async function resolveInput(input){
  const raw=String(input||'').trim();
  if(/^5\d{8}$/.test(raw))return {selected:{ulan_id:raw,name:null,score:100,match:true},candidates:[]};
  const candidates=await reconcileName(raw);return {selected:candidates[0]||null,candidates};
}
module.exports={PAGE,fetchProfile,reconcileName,resolveInput,parseRelationships,decodeHtml};
