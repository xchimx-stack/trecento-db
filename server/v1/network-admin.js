const {createClient}=require('@supabase/supabase-js');
const crypto=require('node:crypto');
const {fetchProfile,resolveInput,normalizePlaceLabel}=require('./ulan.js');
const {normQualifier,normalizeByRule}=require('./relationship-normalizer.js');

function db(){
  const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!u||!k)throw new Error('Supabase admin configuration missing');
  return createClient(u,k,{auth:{persistSession:false,autoRefreshToken:false}});
}
function configuredAdminToken(){
  // WIKI_CRAWL_TOKEN is the established project credential. The aliases make
  // v1 compatible with older/local deployments without creating a new secret.
  return String(
    process.env.WIKI_CRAWL_TOKEN ||
    process.env.ADMIN_TOKEN ||
    process.env.CRAWL_TOKEN ||
    ''
  ).trim();
}
function suppliedAdminToken(req){
  const crawl=req.headers['x-crawl-token'];
  const admin=req.headers['x-admin-token'];
  const auth=String(req.headers.authorization||'');
  const bearer=/^\s*Bearer\s+(.+?)\s*$/i.exec(auth)?.[1];
  return String(crawl||admin||bearer||'').trim();
}
function authorized(req){
  const expected=configuredAdminToken();
  return Boolean(expected) && suppliedAdminToken(req)===expected;
}
function slugify(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64)}
function tierForDepth(d){return Number(d)===0?'core':Number(d)===1?'expanded':'comprehensive'}
function arr(v){return Array.isArray(v)?v:[]}
function uniq(a){return [...new Set(a.filter(Boolean))]}
const normQ=normQualifier;
const MEDIA_BUCKET='v1-media';
const MEDIA_DEFAULT_CAP_BYTES=Number(process.env.SUPABASE_STORAGE_CAP_BYTES||1000000000);
let wikidataLastRequestAt=0;
const WIKIDATA_MIN_INTERVAL_MS=450;
let wikimediaLastRequestAt=0;
const WIKIMEDIA_MIN_INTERVAL_MS=800;
async function wikimediaPace(){
  const wait=WIKIMEDIA_MIN_INTERVAL_MS-(Date.now()-wikimediaLastRequestAt);
  if(wait>0)await sleep(wait);
  wikimediaLastRequestAt=Date.now();
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wikidataPace(){
  const wait=WIKIDATA_MIN_INTERVAL_MS-(Date.now()-wikidataLastRequestAt);
  if(wait>0)await sleep(wait);
  wikidataLastRequestAt=Date.now();
}
function retryAfterMs(response,attempt){
  const raw=response?.headers?.get?.('retry-after');
  if(raw){
    const seconds=Number(raw);
    if(Number.isFinite(seconds))return Math.max(1000,seconds*1000);
    const at=Date.parse(raw);
    if(Number.isFinite(at))return Math.max(1000,at-Date.now());
  }
  return Math.min(20000,5000*Math.pow(2,attempt));
}
const MEDIA_CUTOFF_BYTES=Math.floor(MEDIA_DEFAULT_CAP_BYTES*0.50);
const MEDIA_MAX_FILE_BYTES=2*1024*1024;
const MEDIA_RECHECK_DAYS=90;
function isoAfterDays(days){return new Date(Date.now()+days*86400000).toISOString()}
function isoAfterMinutes(minutes){return new Date(Date.now()+minutes*60000).toISOString()}
function wikiLanguageOrder(network){
  // English is the canonical public-link target. Local-language Wikipedias are
  // fallbacks only when Wikidata has no enwiki sitelink and English title search fails.
  const t=`${network?.name||''} ${network?.public_label||''} ${network?.geography_notes||''}`.toLowerCase();
  const local=/france|french/.test(t)?'fr':/german|germany|deutsch/.test(t)?'de':/dutch|flemish|low countries|netherland/.test(t)?'nl':/ital|trecento|floren|siena|venet/.test(t)?'it':null;
  return ['en',local,'de','fr','it','nl'].filter((x,i,a)=>x&&a.indexOf(x)===i);
}

function mediaNameNorm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\([^)]*\)/g,' ').replace(/[^a-z0-9]+/g,' ').trim()}
function mediaNameScore(name,title){
  const a=mediaNameNorm(name),b=mediaNameNorm(title);if(!a||!b)return 0;if(a===b)return 1;
  const stop=new Set(['the','of','di','da','de','del','della','van','von','der','le','la','il']);
  const A=new Set(a.split(/\s+/).filter(x=>x&&!stop.has(x))),B=new Set(b.split(/\s+/).filter(x=>x&&!stop.has(x)));
  if(!A.size||!B.size)return 0;let hit=0;for(const x of A)if(B.has(x))hit++;return hit/Math.max(A.size,B.size);
}
async function wikiQuery(lang,params){
  const host=lang==='commons'?'commons.wikimedia.org':`${lang}.wikipedia.org`;
  const u=new URL(`https://${host}/w/api.php`);
  const merged={...params,action:'query',format:'json',formatversion:2,maxlag:5,origin:'*'};
  for(const [k,v] of Object.entries(merged))if(v!==undefined&&v!==null)u.searchParams.set(k,String(v));
  let lastError=null;
  for(let attempt=0;attempt<3;attempt++){
    await wikimediaPace();
    const r=await fetch(u,{headers:{
      Accept:'application/json',
      'Accept-Encoding':'gzip, deflate',
      'User-Agent':'TrecentoArtNetwork/1.0.14 (https://trecento-db-b32f.vercel.app; admin media cache)'
    }});
    if(r.ok){
      wikimediaLastRequestAt=Date.now();
      const d=await r.json();
      if(d?.error?.code==='maxlag'){
        lastError=new Error(`${host} maxlag (${d?.error?.lag||'busy'})`);
        lastError.retryable=true;
        await sleep(Math.min(12000,Math.max(3000,Number(d?.error?.lag||0)*1000)));
        continue;
      }
      return d;
    }
    lastError=new Error(`${host} ${r.status}`);
    if(r.status===429||r.status===503){
      lastError.retryable=true;
      const wait=retryAfterMs(r,attempt);
      if(wait>15000){lastError.retry_after_ms=wait;throw lastError}
      await sleep(wait);
      continue;
    }
    throw lastError;
  }
  if(lastError)lastError.retryable=true;
  throw lastError||new Error(`${host} retry limit reached`);
}
function usableWikiPage(page,name){return page&&page.ns===0&&!page.missing&&mediaNameScore(name,page.title)>=0.55}
function wikidataClaimValues(entity,property){
  const claims=entity?.claims?.[property]||[];
  return claims.map(c=>c?.mainsnak?.datavalue?.value).filter(v=>typeof v==='string').map(String);
}
async function wikidataApi(params){
  const u=new URL('https://www.wikidata.org/w/api.php');
  const merged={...params,maxlag:5,format:'json',formatversion:2,origin:'*'};
  for(const [k,v] of Object.entries(merged))if(v!==undefined&&v!==null)u.searchParams.set(k,String(v));
  let lastError=null;
  for(let attempt=0;attempt<4;attempt++){
    await wikidataPace();
    const r=await fetch(u,{
      headers:{
        Accept:'application/json',
        'Accept-Encoding':'gzip, deflate',
        'User-Agent':'TrecentoArtNetwork/1.0.14 (https://trecento-db-b32f.vercel.app; admin media cache)'
      }
    });
    if(r.ok){
      wikidataLastRequestAt=Date.now();
      const d=await r.json();
      if(d?.error?.code==='maxlag'){
        const wait=Math.min(15000,Math.max(3000,Number(d?.error?.lag||0)*1000));
        lastError=new Error(`Wikidata maxlag (${d?.error?.lag||'busy'})`);
        await sleep(wait);
        continue;
      }
      return d;
    }
    lastError=new Error(`Wikidata API ${r.status}`);
    if(r.status===429||r.status===503){
      const wait=retryAfterMs(r,attempt);
      await sleep(wait);
      continue;
    }
    throw lastError;
  }
  throw lastError||new Error('Wikidata API retry limit reached');
}
async function wikidataEntities(qids){
  const ids=[...new Set((qids||[]).filter(x=>/^Q\d+$/.test(String(x))))].slice(0,20);
  if(!ids.length)return [];
  const d=await wikidataApi({action:'wbgetentities',ids:ids.join('|'),props:'claims|sitelinks|labels|descriptions'});
  return ids.map(id=>d?.entities?.[id]).filter(Boolean);
}
function mediaNameVariants(name){
  const raw=String(name||'').trim(),out=[raw];
  // ULAN often stores inverted display names: "Holbein, Hans, the younger".
  const bits=raw.split(',').map(x=>x.trim()).filter(Boolean);
  if(bits.length>=2){
    const family=bits.shift(),rest=bits.join(' ').replace(/^(the|der|le|la)\s+/i,m=>m);
    out.push(`${rest} ${family}`.replace(/\s+/g,' ').trim());
  }
  out.push(raw.replace(/,\s*/g,' '));
  return [...new Set(out.map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean))];
}
async function wikidataFromUlan(ulanId,name,trace=[]){
  const id=String(ulanId||'').trim();
  if(!/^\d+$/.test(id)){trace.push('ULAN ID missing/invalid');return null}

  // Primary path: one exact P245 property search + one batched entity read.
  try{
    const d=await wikidataApi({action:'query',list:'search',srsearch:`haswbstatement:P245=${id}`,srnamespace:0,srlimit:10});
    const qids=(d?.query?.search||[]).map(x=>x.title).filter(x=>/^Q\d+$/.test(String(x)));
    for(const e of await wikidataEntities(qids)){
      if(wikidataClaimValues(e,'P245').includes(id)){
        trace.push(`ULAN ${id} → ${e.id} via exact P245 search`);
        return e;
      }
    }
  }catch(e){
    trace.push(`Wikidata P245 search failed: ${e.message}`);
  }

  // Fallback is deliberately bounded. Search normalized names in EN first,
  // then DE. Each candidate is still accepted only with an exact P245 match.
  const variants=mediaNameVariants(name).slice(0,3);
  for(const lang of ['en','de']){
    for(const variant of variants){
      try{
        const d=await wikidataApi({action:'wbsearchentities',search:variant,language:lang,uselang:'en',type:'item',limit:8});
        const qids=(d?.search||[]).map(x=>x.id).filter(Boolean);
        const entities=await wikidataEntities(qids);
        for(const e of entities){
          if(wikidataClaimValues(e,'P245').includes(id)){
            trace.push(`ULAN ${id} → ${e.id} via validated name search (${lang}: ${variant})`);
            return e;
          }
        }
      }catch(e){
        trace.push(`Wikidata name search failed (${lang}): ${e.message}`);
      }
    }
  }

  // Last-chance multilingual lookup uses only the canonical name once per
  // language, preventing the previous 20–30 requests per unresolved artist.
  const canonical=variants[0]||String(name||'').trim();
  for(const lang of ['it','fr','nl']){
    try{
      const d=await wikidataApi({action:'wbsearchentities',search:canonical,language:lang,uselang:'en',type:'item',limit:8});
      const qids=(d?.search||[]).map(x=>x.id).filter(Boolean);
      for(const e of await wikidataEntities(qids)){
        if(wikidataClaimValues(e,'P245').includes(id)){
          trace.push(`ULAN ${id} → ${e.id} via validated fallback (${lang})`);
          return e;
        }
      }
    }catch(e){
      trace.push(`Wikidata fallback failed (${lang}): ${e.message}`);
    }
  }

  trace.push(`No Wikidata entity with P245=${id} found`);
  return null;
}

async function wikidataSitelink(entityOrQid,lang='en'){
  let e=entityOrQid;
  if(typeof entityOrQid==='string'){
    const [loaded]=await wikidataEntities([entityOrQid]);e=loaded||null;
  }
  return e?.sitelinks?.[`${lang}wiki`]?.title||null;
}
function bodyImageReject(title){
  const t=String(title||'').toLowerCase();
  return /portrait|portr[aä]t|bildnis|self[- _]?portrait|selbstbild|engraving|engraver|woodcut|holzschnitt|etching|radierung|drawing|zeichnung|sketch|study|signature|autograph|coat.of.arms|wappen|logo|grave|tomb|monument|statue|bust|photo|photograph|map|diagram|facsimile|stamp|coin/.test(t);
}
function bodyImageCandidate(title){return /\.(?:jpg|jpeg|png|webp|tif|tiff)$/i.test(String(title||''))&&!bodyImageReject(title)}
function stableChoiceIndex(seed,n){let h=2166136261;for(const c of String(seed||'')){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return n?Math.abs(h>>>0)%n:0}
async function bodyArtworkImage(lang,pageTitle,seed){
  // Pull images transcluded in the article body, reject portrait/graphic-media
  // filenames, then choose a stable pseudo-random work. This deliberately does
  // not use the article lead thumbnail, which is frequently a portrait OF the artist.
  const d=await wikiQuery(lang,{titles:pageTitle,prop:'images',imlimit:100});
  const images=(d?.query?.pages?.[0]?.images||[]).map(x=>x.title).filter(bodyImageCandidate);
  if(!images.length)return null;
  const rotated=[...images.slice(stableChoiceIndex(seed,images.length)),...images.slice(0,stableChoiceIndex(seed,images.length))].slice(0,16);
  const info=await wikiQuery('commons',{titles:rotated.join('|'),prop:'imageinfo',iiprop:'url|mime',iiurlwidth:640});
  const byTitle=new Map((info?.query?.pages||[]).map(p=>[p.title,p]));
  for(const title of rotated){const ii=byTitle.get(title)?.imageinfo?.[0],url=ii?.thumburl||ii?.url;if(url&&/^image\/(jpeg|png|webp)/i.test(ii?.mime||'image/jpeg'))return {url,title}}
  return null;
}
function wikipediaPageUrl(lang,title){return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(title||'').replace(/ /g,'_'))}`}
async function resolvedKnownSitelink(lang,title,name,method,wikidataId,seed,trace=[]){
  let art=null,mediaRetry=false;
  try{art=await bodyArtworkImage(lang,title,seed)}
  catch(e){trace.push(`Artwork image lookup deferred: ${e.message}`);mediaRetry=Boolean(e.retryable)}
  return {language:lang,title,wikipedia_url:wikipediaPageUrl(lang,title),wikidata_id:wikidataId||null,thumbnail_source_url:art?.url||null,thumbnail_file_title:art?.title||null,page_id:null,match_method:method,score:1,media_retry:mediaRetry,resolution_trace:trace};
}
async function resolvedPageMedia(lang,page,name,method,wikidataId,seed){
  if(!page)return null;
  const art=await bodyArtworkImage(lang,page.title,seed);
  return {language:lang,title:page.title,wikipedia_url:page.fullurl||`https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g,'_'))}`,wikidata_id:wikidataId||page.pageprops?.wikibase_item||null,thumbnail_source_url:art?.url||null,thumbnail_file_title:art?.title||null,page_id:page.pageid||null,match_method:method,score:mediaNameScore(name,page.title)};
}
async function resolveWikipediaMedia(artist,network,preferredLanguage){
  const name=artist.canonical_name,ulanId=artist.ulan_id,seed=artist.id||ulanId||name;
  const trace=[];
  // Primary authority path: Getty ULAN P245 -> Wikidata API -> English Wikipedia sitelink.
  const entity=await wikidataFromUlan(ulanId,name,trace);
  const qid=entity?.id||null;
  if(entity){
    const enTitle=await wikidataSitelink(entity,'en');
    if(enTitle){
      trace.push(`${qid} → enwiki: ${enTitle}`);
      return resolvedKnownSitelink('en',enTitle,name,'ulan_wikidata_enwiki',qid,seed,trace);
    }
    trace.push(`${qid} has no English Wikipedia sitelink`);
    // English remains preferred, but if Wikidata already has a local-language
    // sitelink use it directly before any title/name search.
    for(const lang of wikiLanguageOrder(network).filter(x=>x!=='en')){
      const localTitle=await wikidataSitelink(entity,lang);
      if(localTitle){
        trace.push(`${qid} → ${lang}wiki: ${localTitle}`);
        return resolvedKnownSitelink(lang,localTitle,name,'ulan_wikidata_localwiki',qid,seed,trace);
      }
    }
  }
  // Fallback is still English-first, then local-language title search.
  const langs=['en',preferredLanguage,...wikiLanguageOrder(network)].filter((x,i,a)=>x&&a.indexOf(x)===i);
  for(const lang of langs){
    try{
      let d=await wikiQuery(lang,{titles:name,redirects:1,prop:'info|pageprops',inprop:'url'}),page=(d?.query?.pages||[]).find(p=>usableWikiPage(p,name)),method='exact_title';
      if(!page){d=await wikiQuery(lang,{generator:'search',gsrsearch:name,gsrnamespace:0,gsrlimit:5,prop:'info|pageprops',inprop:'url'});page=(d?.query?.pages||[]).filter(p=>usableWikiPage(p,name)).sort((a,b)=>mediaNameScore(name,b.title)-mediaNameScore(name,a.title))[0];method='search'}
      if(page){const r=await resolvedPageMedia(lang,page,name,method,qid||page.pageprops?.wikibase_item||null,seed);r.resolution_trace=[...trace,`Fallback ${lang} ${method}: ${page.title}`];return r}
    }catch{}
  }
  return {unresolved:true,resolution_trace:trace};
}

function safeWikimediaUrl(v){try{const u=new URL(v);return u.protocol==='https:'&&(u.hostname==='upload.wikimedia.org'||u.hostname.endsWith('.wikimedia.org'))?u.toString():null}catch{return null}}
function mediaExt(contentType){if(/png/i.test(contentType))return 'png';if(/webp/i.test(contentType))return 'webp';return 'jpg'}
async function mediaUsage(s){
  const {data,error}=await s.from('v1_media_cache').select('file_size_bytes');if(error)throw error;
  return (data||[]).reduce((n,x)=>n+Math.max(0,Number(x.file_size_bytes)||0),0);
}
async function fetchWikimediaBinary(url){
  let lastError=null;
  for(let attempt=0;attempt<3;attempt++){
    await wikimediaPace();
    const r=await fetch(url,{headers:{'User-Agent':'TrecentoArtNetwork/1.0.14 (https://trecento-db-b32f.vercel.app; media cache)'}});
    if(r.ok)return r;
    lastError=new Error(`Wikimedia image ${r.status}`);
    if(r.status===429||r.status===503){const wait=retryAfterMs(r,attempt);if(wait>15000)throw lastError;await sleep(wait);continue}
    throw lastError;
  }
  throw lastError||new Error('Wikimedia image retry limit reached');
}
async function cacheWikipediaMedia(s,network,artist,force=false){
  const {data:existing,error:eErr}=await s.from('v1_media_cache').select('*').eq('artist_id',artist.id).maybeSingle();if(eErr)throw eErr;
  const now=Date.now(),due=!existing?.next_check_at||Date.parse(existing.next_check_at)<=now;
  if(!force&&existing&&['valid','no_image'].includes(existing.status)&&!due)return {status:'fresh',cache:existing};
  const resolved=await resolveWikipediaMedia(artist,network,existing?.wikipedia_language||null);
  const stamp=new Date().toISOString();
  if(!resolved||resolved.unresolved){
    const payload={artist_id:artist.id,status:'invalid',verified_at:stamp,next_check_at:isoAfterDays(MEDIA_RECHECK_DAYS),updated_at:stamp};
    const {data,error}=await s.from('v1_media_cache').upsert(payload,{onConflict:'artist_id'}).select('*').single();if(error)throw error;
    return {status:'invalid',cache:data,resolution_trace:resolved?.resolution_trace||['Resolver returned no result']};
  }
  let storagePath=existing?.storage_path||null,fileSize=Number(existing?.file_size_bytes)||0;
  const source=safeWikimediaUrl(resolved.thumbnail_source_url);
  let status=resolved.media_retry?'retry':(source?'valid':'no_image');
  if(source){
    const used=await mediaUsage(s);
    if(used-fileSize<MEDIA_CUTOFF_BYTES){
      try{
        const rr=await fetchWikimediaBinary(source);
        if(rr.ok){
          const buf=Buffer.from(await rr.arrayBuffer());
          if(buf.length<=MEDIA_MAX_FILE_BYTES && used-fileSize+buf.length<=MEDIA_CUTOFF_BYTES){
            const ct=rr.headers.get('content-type')||'image/jpeg',path=`${artist.id}.${mediaExt(ct)}`;
            const {error:uErr}=await s.storage.from(MEDIA_BUCKET).upload(path,buf,{contentType:ct,upsert:true,cacheControl:'31536000'});
            if(!uErr){if(existing?.storage_path&&existing.storage_path!==path)await s.storage.from(MEDIA_BUCKET).remove([existing.storage_path]);storagePath=path;fileSize=buf.length}
          }
        }
      }catch{}
    }
  }
  const sourceHash=crypto.createHash('sha256').update(JSON.stringify({title:resolved.title,wikidata:resolved.wikidata_id,thumb:resolved.thumbnail_source_url,file:resolved.thumbnail_file_title})).digest('hex');
  const payload={artist_id:artist.id,wikipedia_url:resolved.wikipedia_url,wikipedia_language:resolved.language,wikidata_id:resolved.wikidata_id,thumbnail_source_url:resolved.thumbnail_source_url,storage_path:storagePath,file_size_bytes:fileSize||null,source_page_url:resolved.wikipedia_url,status,resolved_at:existing?.resolved_at||stamp,verified_at:stamp,next_check_at:status==='retry'?isoAfterMinutes(20):isoAfterDays(MEDIA_RECHECK_DAYS),source_hash:sourceHash,updated_at:stamp};
  const {data,error}=await s.from('v1_media_cache').upsert(payload,{onConflict:'artist_id'}).select('*').single();if(error)throw error;
  return {status,cache:data,match:{language:resolved.language,title:resolved.title,method:resolved.match_method,score:resolved.score},resolution_trace:resolved.resolution_trace||[],storage_cutoff_bytes:MEDIA_CUTOFF_BYTES};
}

async function networkBy(s,ref){
  let q=s.from('v1_networks').select('*');
  if(/^[0-9a-f-]{36}$/i.test(String(ref||'')))q=q.eq('id',ref);else q=q.eq('slug',String(ref||''));
  const {data,error}=await q.limit(1);if(error)throw error;return data?.[0]||null;
}
async function ensureArtistAndProfile(s,profile){
  const ulan=String(profile.ulan_id);
  let {data:artists,error:aErr}=await s.from('v1_artists').select('*').eq('ulan_id',ulan).limit(1);if(aErr)throw aErr;
  let artist=artists?.[0];
  if(!artist){
    const {data,error}=await s.from('v1_artists').insert({canonical_name:profile.preferred_name||`ULAN ${ulan}`,entity_type:/corporate/i.test(profile.record_type||'')?'corporate_body':'person',ulan_id:ulan}).select('*').single();if(error)throw error;artist=data;
  }else if(profile.preferred_name&&artist.canonical_name!==profile.preferred_name){
    const {data,error}=await s.from('v1_artists').update({canonical_name:profile.preferred_name,updated_at:new Date().toISOString()}).eq('id',artist.id).select('*').single();if(error)throw error;artist=data;
  }
  const snapshot={preferred_name:profile.preferred_name,record_type:profile.record_type,aliases:profile.aliases,roles:profile.roles,roles_raw:profile.raw,nationalities:profile.nationalities,period_start:profile.period_start,period_end:profile.period_end,birth_place:profile.birth_place,death_place:profile.death_place,active_places:profile.active_places};
  const {data:prior,error:pErr}=await s.from('v1_ulan_profiles').select('source_hash').eq('artist_id',artist.id).limit(1);if(pErr)throw pErr;
  const changed=!prior?.length||prior[0].source_hash!==profile.source_hash;
  const payload={artist_id:artist.id,ulan_id:ulan,preferred_name:profile.preferred_name,record_type:profile.record_type,aliases:profile.aliases||[],roles:profile.roles||[],roles_raw:profile.raw||null,nationalities:profile.nationalities||null,period_start:profile.period_start,period_end:profile.period_end,birth_place:profile.birth_place||null,death_place:profile.death_place||null,active_places:profile.active_places||[],parsed_snapshot:snapshot,source_url:profile.source_url,source_hash:profile.source_hash,fetched_at:new Date().toISOString(),...(changed?{last_changed_at:new Date().toISOString()}:{})};
  const {error:uErr}=await s.from('v1_ulan_profiles').upsert(payload,{onConflict:'artist_id'});if(uErr)throw uErr;
  return artist;
}
async function rulesMap(s){const {data,error}=await s.from('v1_relationship_rules').select('*').eq('active',true);if(error)throw error;return new Map((data||[]).map(r=>[normQ(r.raw_qualifier),r]))}
async function saveUnknown(s,rel,sourceUrl){
  const q=normQ(rel.raw_qualifier);const {data}=await s.from('v1_unknown_qualifiers').select('*').eq('raw_qualifier',q).limit(1);
  if(data?.length){await s.from('v1_unknown_qualifiers').update({last_seen_at:new Date().toISOString(),seen_count:Number(data[0].seen_count||0)+1,sample_focus_ulan:rel.focus_ulan,sample_counterpart_ulan:rel.related_ulan,sample_source_url:sourceUrl}).eq('raw_qualifier',q)}
  else await s.from('v1_unknown_qualifiers').insert({raw_qualifier:q,sample_focus_ulan:rel.focus_ulan,sample_counterpart_ulan:rel.related_ulan,sample_source_url:sourceUrl});
}
async function upsertAssertions(s,artist,profile,network){
  const rules=await rulesMap(s),currentKeys=new Set(),normalized=[];let quarantined=0;
  for(const rel of profile.relationships||[]){
    const raw=normQ(rel.raw_qualifier),rule=rules.get(raw);let row;
    if(rule){row=normalizeByRule({...rel,raw_qualifier:raw},rule);normalized.push(row)}
    else{quarantined++;row={...rel,raw_qualifier:raw,normalized_family:null,canonical_from_ulan:null,canonical_to_ulan:null,directed:null,visual_class:null,expansion_eligible:false,render_eligible:false,mapping_status:'quarantined'};await saveUnknown(s,row,profile.source_url)}
    currentKeys.add(`${row.counterpart_ulan||row.related_ulan}|${raw}`);
    const payload={focus_artist_id:artist.id,focus_ulan_id:profile.ulan_id,counterpart_ulan_id:row.related_ulan,counterpart_label:row.related_label||null,raw_qualifier:raw,normalized_family:row.normalized_family||null,canonical_from_ulan:row.canonical_from_ulan||null,canonical_to_ulan:row.canonical_to_ulan||null,directed:row.directed,visual_class:row.visual_class||null,expansion_eligible:Boolean(row.expansion_eligible),render_eligible:Boolean(row.render_eligible),mapping_status:row.mapping_status,raw_context:row.raw_context||null,source_url:profile.source_url,source_hash:profile.source_hash,fetched_at:new Date().toISOString()};
    const {error}=await s.from('v1_ulan_relationship_assertions').upsert(payload,{onConflict:'focus_ulan_id,counterpart_ulan_id,raw_qualifier'});if(error)throw error;
  }
  const {data:existing,error:eErr}=await s.from('v1_ulan_relationship_assertions').select('id,counterpart_ulan_id,raw_qualifier').eq('focus_ulan_id',profile.ulan_id);if(eErr)throw eErr;
  for(const old of existing||[]){if(!currentKeys.has(`${old.counterpart_ulan_id}|${normQ(old.raw_qualifier)}`)){const {error}=await s.from('v1_ulan_relationship_assertions').delete().eq('id',old.id);if(error)throw error}}

  const families=new Set(arr(network.relationship_families));
  const {data:members,error:mErr}=await s.from('v1_network_memberships').select('artist_id,v1_artists!inner(ulan_id)').eq('network_id',network.id).eq('included',true);if(mErr)throw mErr;
  const memberUlans=new Set((members||[]).map(m=>String(m.v1_artists?.ulan_id||'')));
  let candidateTouches=0;
  for(const r of normalized){
    if(!r.expansion_eligible||!families.has(r.normalized_family))continue;
    const counterpart=String(r.related_ulan);if(memberUlans.has(counterpart))continue;
    const depth=Math.min(2,(await memberDepthByUlan(s,network.id,profile.ulan_id))+1);if(depth>network.max_depth)continue;
    const {data:old,error:oErr}=await s.from('v1_network_candidates').select('*').eq('network_id',network.id).eq('ulan_id',counterpart).limit(1);if(oErr)throw oErr;
    const prev=old?.[0];
    const sourceIds=uniq([...(prev?.source_ulan_ids||[]),profile.ulan_id]);
    const qualifiers=uniq([...(prev?.source_qualifiers||[]),r.raw_qualifier]);
    const payload={network_id:network.id,ulan_id:counterpart,preferred_name:r.related_label||prev?.preferred_name||null,discovered_depth:Math.min(prev?.discovered_depth||depth,depth),source_ulan_ids:sourceIds,source_qualifiers:qualifiers,updated_at:new Date().toISOString()};
    const {error}=await s.from('v1_network_candidates').upsert(payload,{onConflict:'network_id,ulan_id'});if(error)throw error;candidateTouches++;
  }
  return {relationship_count:(profile.relationships||[]).length,mapped:normalized.length,quarantined,candidate_touches:candidateTouches};
}
async function memberDepthByUlan(s,networkId,ulan){
  const {data,error}=await s.from('v1_network_memberships').select('graph_depth,v1_artists!inner(ulan_id)').eq('network_id',networkId).eq('v1_artists.ulan_id',ulan).limit(1);if(error)throw error;return data?.[0]?.graph_depth??0;
}
function scopeStatus(network,profile){
  const ns=Number(network.start_year),ne=Number(network.end_year);
  const rawStart=profile?.period_start,rawEnd=profile?.period_end;
  const ps=rawStart==null||rawStart===''?NaN:Number(rawStart);
  const pe=rawEnd==null||rawEnd===''?NaN:Number(rawEnd);
  const hasStart=Number.isFinite(ps)&&ps>0;
  const hasEnd=Number.isFinite(pe)&&pe>0;
  if(Number.isFinite(ns)&&Number.isFinite(ne)&&hasStart){
    const effectiveEnd=hasEnd?pe:ps;
    if(effectiveEnd<ns||ps>ne)return {status:'chronology_out',reason:`ULAN chronology ${ps}${hasEnd&&pe!==ps?`–${pe}`:''} is outside ${ns}–${ne}`};
  }
  if(profile.record_type && !/^person$/i.test(String(profile.record_type))) return {status:'role_out',reason:`ULAN record type ${profile.record_type} is not a person`};
  if(Number.isFinite(ns)&&Number.isFinite(ne)&&!hasStart)
    return {status:'eligible',reason:'CHRONOLOGY_UNKNOWN — ULAN did not provide a machine-readable date; candidate retained'};
  // ULAN roles are descriptive and normalized for viewer filtering; they are not an admission gate.
  return {status:'eligible',reason:'Passes configured chronology/role scope'};
}

async function republishIfRequested(s,network,defer=false){
  if(defer)return null;
  return publishNetworkSnapshot(s,network);
}
function parseWikiArticleUrl(url){
  try{
    const u=new URL(String(url||''));
    const m=/^([a-z-]+)\.wikipedia\.org$/i.exec(u.hostname);
    if(!m)return null;
    const title=decodeURIComponent((u.pathname.split('/wiki/')[1]||'').replace(/_/g,' '));
    return title?{lang:m[1].toLowerCase(),title}:null;
  }catch{return null}
}
function wikiRelNorm(v){return mediaNameNorm(v).replace(/\b(the|younger|elder|older|younger)\b/g,' ').replace(/\s+/g,' ').trim()}
function wikiRelVariants(name,aliases=[]){
  const out=[...mediaNameVariants(name),...(aliases||[])];
  return [...new Set(out.map(wikiRelNorm).filter(x=>x.length>=3))];
}
function sentenceChunks(text){
  return String(text||'').replace(/\s+/g,' ').split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ])/).map(x=>x.trim()).filter(Boolean);
}
function mentionsVariant(sentence,variants){
  const n=wikiRelNorm(sentence);
  return variants.some(v=>v.length>=4&&(n===v||n.includes(` ${v} `)||n.startsWith(`${v} `)||n.endsWith(` ${v}`)));
}
function classifyWikiRelationship(sentence,subjectYear,targetYear){
  const t=String(sentence||'').toLowerCase();
  const diff=(Number.isFinite(subjectYear)&&Number.isFinite(targetYear))?subjectYear-targetYear:null;
  const chronologyOk=(family,fromIsSubject)=>{
    if(!Number.isFinite(diff))return true;
    if(Math.abs(diff)>80)return false;
    if(family==='training'){
      // Canonical direction is teacher/master -> pupil/student.
      const teacherYear=fromIsSubject?subjectYear:targetYear,pupilYear=fromIsSubject?targetYear:subjectYear;
      if(Number.isFinite(teacherYear)&&Number.isFinite(pupilYear)&&teacherYear-pupilYear>25)return false;
    }
    return true;
  };
  if(/\b(pupil|student|apprentice|assistant)\b.{0,50}\b(of|to)\b|\bstudied under\b|\btrained (under|by)\b|\bapprenticed (to|under)\b/.test(t)){
    if(!chronologyOk('training',false))return null;
    return {family:'training',directed:true,visual_class:'solid',subject_is_from:false,type:'student/pupil of'};
  }
  if(/\bteacher of\b|\btaught\b|\btrained\b.{0,30}\b(pupil|student|apprentice)\b|\bpupils? included\b|\bstudents? included\b/.test(t)){
    if(!chronologyOk('training',true))return null;
    return {family:'training',directed:true,visual_class:'solid',subject_is_from:true,type:'teacher of'};
  }
  if(/\binfluenced by\b|\bwas influenced by\b|\bdrew influence from\b/.test(t)){
    if(!chronologyOk('influence',false))return null;
    return {family:'influence',directed:true,visual_class:'dashed',subject_is_from:false,type:'influenced by'};
  }
  if(/\binfluenced\b|\binfluence on\b/.test(t)){
    if(!chronologyOk('influence',true))return null;
    return {family:'influence',directed:true,visual_class:'dashed',subject_is_from:true,type:'influenced'};
  }
  if(/\bcollaborated with\b|\bworked with\b|\bworked alongside\b|\bworked together\b|\bjointly with\b/.test(t)){
    if(!chronologyOk('collaboration',true))return null;
    return {family:'collaboration',directed:false,visual_class:'dashed',subject_is_from:true,type:'collaborated/worked with'};
  }
  if(/\b(brother|sister|father|mother|son|daughter|uncle|nephew|cousin) of\b/.test(t)){
    if(!chronologyOk('family',true))return null;
    return {family:'family',directed:false,visual_class:'dotted',subject_is_from:true,type:'family relation'};
  }
  return null;
}
async function wikiRelationshipMembers(s,network){
  const {data,error}=await s.from('v1_network_memberships')
    .select('artist_id,v1_artists!inner(id,canonical_name,ulan_id)')
    .eq('network_id',network.id).eq('included',true);
  if(error)throw error;
  const ids=(data||[]).map(x=>x.artist_id);
  let profiles=[],media=[];
  if(ids.length){
    const [pr,mr]=await Promise.all([
      s.from('v1_ulan_profiles').select('artist_id,aliases,period_start,period_end').in('artist_id',ids),
      s.from('v1_media_cache').select('artist_id,wikipedia_url,wikipedia_language').in('artist_id',ids)
    ]);
    if(pr.error)throw pr.error;if(mr.error)throw mr.error;
    profiles=pr.data||[];media=mr.data||[];
  }
  const pb=new Map(profiles.map(x=>[x.artist_id,x])),mb=new Map(media.map(x=>[x.artist_id,x]));
  return (data||[]).map(x=>{
    const a=x.v1_artists,p=pb.get(x.artist_id)||{},m=mb.get(x.artist_id)||{};
    const ps=Number(p.period_start),pe=Number(p.period_end);
    return {id:a.id,canonical_name:a.canonical_name,ulan_id:a.ulan_id,aliases:Array.isArray(p.aliases)?p.aliases:[],
      layout_year:Number.isFinite(ps)&&Number.isFinite(pe)?Math.round((ps+pe)/2):(Number.isFinite(ps)?ps:(Number.isFinite(pe)?pe:null)),
      wikipedia_url:m.wikipedia_url||null,wikipedia_language:m.wikipedia_language||null};
  });
}
async function scanWikipediaRelationshipsForArtist(s,network,subjectUlan){
  const members=await wikiRelationshipMembers(s,network);
  const subject=members.find(x=>String(x.ulan_id)===String(subjectUlan));
  if(!subject)return {status:'not_member',found:0,accepted:0,quarantined:0};
  const parsed=parseWikiArticleUrl(subject.wikipedia_url);
  if(!parsed)return {status:'no_wikipedia',found:0,accepted:0,quarantined:0};
  const page=await wikiQuery(parsed.lang,{titles:parsed.title,redirects:1,prop:'extracts|links',explaintext:1,exsectionformat:'plain',plnamespace:0,pllimit:'max'});
  const p=(page?.query?.pages||[]).find(x=>!x.missing);
  if(!p)return {status:'no_page',found:0,accepted:0,quarantined:0};
  const linked=new Set((p.links||[]).map(x=>wikiRelNorm(x.title)));
  const sentences=sentenceChunks(p.extract||'');
  const targets=[];
  for(const target of members){
    if(target.id===subject.id)continue;
    const variants=wikiRelVariants(target.canonical_name,target.aliases);
    if(!variants.some(v=>linked.has(v)))continue;
    targets.push({...target,_variants:variants});
  }
  // Replace this subject's stored Wikipedia assertions on each scan; disabled source policy does not delete them.
  const {error:dErr}=await s.from('v1_wikipedia_relationships').delete().eq('network_id',network.id).eq('subject_artist_id',subject.id);
  if(dErr)throw dErr;
  let found=0,accepted=0,quarantined=0;
  const rows=[];
  for(const target of targets){
    const sentence=sentences.find(sent=>mentionsVariant(sent,target._variants));
    if(!sentence)continue;
    found++;
    const rel=classifyWikiRelationship(sentence,subject.layout_year,target.layout_year);
    if(!rel){quarantined++;continue}
    const from=rel.subject_is_from?subject:target,to=rel.subject_is_from?target:subject;
    rows.push({
      network_id:network.id,subject_artist_id:subject.id,counterpart_artist_id:target.id,
      from_artist_id:from.id,to_artist_id:to.id,normalized_family:rel.family,directed:rel.directed,
      visual_class:rel.visual_class,relationship_type:rel.type,source_url:subject.wikipedia_url,
      evidence_text:sentence.slice(0,1600),confidence:0.70,status:'candidate',active:true,updated_at:new Date().toISOString()
    });
  }
  if(rows.length){
    const {error:iErr}=await s.from('v1_wikipedia_relationships').insert(rows);
    if(iErr)throw iErr;
    accepted=rows.length;
  }
  return {status:'scanned',found,accepted,quarantined,article:subject.wikipedia_url};
}
async function wikipediaRelationshipStatus(s,network){
  const [{data:rels,error:rErr},{data:runs,error:sErr}]=await Promise.all([
    s.from('v1_wikipedia_relationships').select('id,status,active').eq('network_id',network.id),
    s.from('v1_sync_runs').select('*').eq('network_id',network.id).eq('run_type','wikipedia_relationships').order('started_at',{ascending:false}).limit(1)
  ]);
  if(rErr)throw rErr;if(sErr)throw sErr;
  return {enabled:Boolean(network.wikipedia_relationships_enabled),stored:(rels||[]).filter(x=>x.active).length,last_run:runs?.[0]||null};
}
async function deleteNetworkAndOrphans(s,network){
  const {data:members,error:mErr}=await s.from('v1_network_memberships').select('artist_id').eq('network_id',network.id);
  if(mErr)throw mErr;
  const candidateArtistIds=[...new Set((members||[]).map(x=>x.artist_id))];
  const counts={members:candidateArtistIds.length,candidates:0,overrides:0,manual_relationships:0,wikipedia_relationships:0,published:0,sync_runs:0,orphan_artists_deleted:0,storage_files_deleted:0};
  const countTable=async(table)=>{
    const {count,error}=await s.from(table).select('*',{count:'exact',head:true}).eq('network_id',network.id);
    if(error)throw error;return count||0;
  };
  [counts.candidates,counts.overrides,counts.manual_relationships,counts.wikipedia_relationships,counts.published,counts.sync_runs]=await Promise.all([
    countTable('v1_network_candidates'),countTable('v1_curatorial_overrides'),countTable('v1_curatorial_relationships'),
    countTable('v1_wikipedia_relationships'),countTable('v1_published_networks'),countTable('v1_sync_runs')
  ]);
  const {error:delErr}=await s.from('v1_networks').delete().eq('id',network.id);if(delErr)throw delErr;
  for(const artistId of candidateArtistIds){
    const {count,error:cErr}=await s.from('v1_network_memberships').select('*',{count:'exact',head:true}).eq('artist_id',artistId);
    if(cErr)throw cErr;if((count||0)>0)continue;
    const {data:mc}=await s.from('v1_media_cache').select('storage_path').eq('artist_id',artistId).maybeSingle();
    if(mc?.storage_path){const {error:se}=await s.storage.from(MEDIA_BUCKET).remove([mc.storage_path]);if(!se)counts.storage_files_deleted++}
    const {error:aErr}=await s.from('v1_artists').delete().eq('id',artistId);if(aErr)throw aErr;counts.orphan_artists_deleted++;
  }
  return counts;
}

async function listNetworks(s){
  const {data,error}=await s.from('v1_networks').select('*').order('created_at');if(error)throw error;
  const out=[];for(const n of data||[]){const {data:m}=await s.from('v1_network_memberships').select('graph_depth,included').eq('network_id',n.id).eq('included',true);const counts={core:0,expanded:0,comprehensive:0};for(const x of m||[]){if(x.graph_depth===0)counts.core++;else if(x.graph_depth===1)counts.expanded++;else counts.comprehensive++}out.push({...n,counts,total:(m||[]).length})}return out;
}

function directUlanGeography(profile){
  const active=[...new Set((Array.isArray(profile?.active_places)?profile.active_places:[])
    .map(normalizePlaceLabel).filter(Boolean))];
  if(active.length)return {city:active[0],source:'ULAN active location',active};
  const death=normalizePlaceLabel(profile?.death_place);
  if(death)return {city:death,source:'ULAN death place fallback',active};
  const birth=normalizePlaceLabel(profile?.birth_place);
  if(birth)return {city:birth,source:'ULAN birth place fallback',active};
  return {city:null,source:null,active};
}
function inferCollaborationGeography(artists,edgeRows){
  const byUlan=new Map(artists.map(a=>[String(a.ulan_id||''),a]));
  // Only ULAN + Manual relationships may influence geography/layout.
  const base=[...edgeRows].filter(e=>{
    const sources=Array.isArray(e.sources)&&e.sources.length?e.sources:[e.source||'ULAN'];
    return e.family==='collaboration' && sources.some(x=>x==='ULAN'||x==='Manual');
  });
  for(let pass=0;pass<3;pass++){
    let changed=0;
    for(const artist of artists){
      if(artist.region)continue;
      const id=String(artist.ulan_id||''),neighborCities=[];
      for(const e of base){
        const a=String(e.from_ulan||''),b=String(e.to_ulan||'');
        if(a!==id&&b!==id)continue;
        const other=byUlan.get(a===id?b:a);
        if(other?.region)neighborCities.push(other.region);
      }
      const unique=[...new Set(neighborCities)];
      if(unique.length===1){
        artist.region=unique[0];
        artist.geography_source='ULAN/Manual collaboration fallback';
        changed++;
      }
    }
    if(!changed)break;
  }
}

async function graphPayload(s,network){
  // Memberships have a direct FK to artists, but curatorial overrides are a
  // sibling table keyed by (network_id, artist_id). Do not ask PostgREST to
  // infer a nonexistent memberships -> overrides relationship.
  const {data:members,error}=await s.from('v1_network_memberships')
    .select('*,v1_artists(*)')
    .eq('network_id',network.id)
    .eq('included',true);
  if(error)throw error;
  const artistIds=(members||[]).map(m=>m.v1_artists?.id).filter(Boolean);
  let profiles=[],media=[],overrides=[];
  if(artistIds.length){
    const [pr,mr,or]=await Promise.all([
      s.from('v1_ulan_profiles').select('*').in('artist_id',artistIds),
      s.from('v1_media_cache').select('*').in('artist_id',artistIds),
      s.from('v1_curatorial_overrides').select('*').eq('network_id',network.id).in('artist_id',artistIds)
    ]);
    if(pr.error)throw pr.error;if(mr.error)throw mr.error;if(or.error)throw or.error;
    profiles=pr.data||[];media=mr.data||[];overrides=or.data||[];
  }
  const profileBy=new Map(profiles.map(x=>[x.artist_id,x])),
        mediaBy=new Map(media.map(x=>[x.artist_id,x])),
        overrideBy=new Map(overrides.map(x=>[x.artist_id,x]));
  const artists=(members||[]).map(m=>{
    const a=m.v1_artists;
    const o=overrideBy.get(a.id)||null;
    const pr=profileBy.get(a.id)||{},mc=mediaBy.get(a.id)||{};
    const ps=Number(pr.period_start),pe=Number(pr.period_end);
    const autoYear=Number.isFinite(ps)&&Number.isFinite(pe)?Math.round((ps+pe)/2):(Number.isFinite(ps)?ps:(Number.isFinite(pe)?pe:null));
    const geo=directUlanGeography(pr);
    const birthPlace=normalizePlaceLabel(pr.birth_place),deathPlace=normalizePlaceLabel(pr.death_place);
    return {
      id:a.id,ulan_id:a.ulan_id,canonical_name:o?.display_name||a.canonical_name,
      tier:o?.tier||m.manual_tier||m.automatic_tier,graph_depth:m.graph_depth,origin:m.origin,
      layout_year:o?.layout_year??autoYear,region:o?.region||geo.city,
      geography_source:o?.region?'Manual override':geo.source,
      roles:Array.isArray(pr.roles)?pr.roles:[],roles_raw:pr.roles_raw||null,
      period_start:pr.period_start??null,period_end:pr.period_end??null,
      birth_place:birthPlace,death_place:deathPlace,active_places:geo.active,
      nationalities:pr.nationalities||null,record_type:pr.record_type||null,
      wikipedia_url:mc.wikipedia_url||null,wikipedia_language:mc.wikipedia_language||null,
      wikidata_id:mc.wikidata_id||null,thumbnail_source_url:mc.thumbnail_source_url||null,
      storage_path:mc.storage_path||null,
      thumbnail_url:mc.storage_path?(s.storage.from(MEDIA_BUCKET).getPublicUrl(mc.storage_path).data?.publicUrl||null):null,
      media_status:mc.status||null,media_last_verified:mc.verified_at||null
    };
  });
  const ulanSet=new Set(artists.map(a=>a.ulan_id).filter(Boolean));
  // Publishing is an admin-side materialization step. Restrict the assertion
  // scan to ULAN focus records that are actually members of this network;
  // the public viewer never runs this query.
  let assertionRows=[];
  const memberUlans=[...ulanSet];
  if(memberUlans.length){
    const {data:as,error:aErr}=await s.from('v1_ulan_relationship_assertions')
      .select('*')
      .eq('mapping_status','mapped')
      .in('focus_ulan_id',memberUlans);
    if(aErr)throw aErr;
    assertionRows=as||[];
  }
  const edges=new Map();
  const allowedFamilies=new Set(arr(network.relationship_families));
  const pairFamilies=new Map();
  for(const r of assertionRows){
    if(!r.render_eligible||!allowedFamilies.has(r.normalized_family)||!ulanSet.has(r.canonical_from_ulan)||!ulanSet.has(r.canonical_to_ulan))continue;
    const key=`${r.canonical_from_ulan}|${r.canonical_to_ulan}|${r.normalized_family}`;
    const pair=[r.canonical_from_ulan,r.canonical_to_ulan].sort().join('|');
    if(!pairFamilies.has(pair))pairFamilies.set(pair,new Set());pairFamilies.get(pair).add(r.normalized_family);
    if(!edges.has(key))edges.set(key,{from_ulan:r.canonical_from_ulan,to_ulan:r.canonical_to_ulan,family:r.normalized_family,directed:r.directed,visual_class:r.visual_class,source:'ULAN',sources:['ULAN'],qualifiers:[]});
    const e=edges.get(key);if(!e.qualifiers.includes(r.raw_qualifier))e.qualifiers.push(r.raw_qualifier);
  }
  if(network.wikipedia_relationships_enabled&&artistIds.length){
    const {data:wr,error:wErr}=await s.from('v1_wikipedia_relationships')
      .select('*,from:v1_artists!v1_wikipedia_relationships_from_artist_id_fkey(ulan_id),to:v1_artists!v1_wikipedia_relationships_to_artist_id_fkey(ulan_id)')
      .eq('network_id',network.id).eq('active',true).neq('status','rejected');
    if(wErr)throw wErr;
    for(const r of wr||[]){
      const fu=r.from?.ulan_id,tu=r.to?.ulan_id;if(!fu||!tu||!ulanSet.has(fu)||!ulanSet.has(tu)||!allowedFamilies.has(r.normalized_family))continue;
      const pair=[fu,tu].sort().join('|'),key=`${fu}|${tu}|${r.normalized_family}`;
      const sameFamily=[...edges.entries()].find(([k,e])=>[e.from_ulan,e.to_ulan].sort().join('|')===pair&&e.family===r.normalized_family);
      if(sameFamily){const e=sameFamily[1];e.sources=[...new Set([...(e.sources||[e.source||'ULAN']),'Wikipedia'])];e.wikipedia_evidence=[...(e.wikipedia_evidence||[]),{source_url:r.source_url,evidence_text:r.evidence_text}];continue}
      // If ULAN already asserts a different semantic relation for this pair, keep ULAN authoritative.
      if(pairFamilies.has(pair))continue;
      edges.set(`wiki:${r.id}`,{from_ulan:fu,to_ulan:tu,family:r.normalized_family,directed:r.directed,visual_class:r.visual_class,source:'Wikipedia',sources:['Wikipedia'],note:r.relationship_type||null,evidence:[{source_url:r.source_url,evidence_text:r.evidence_text}]});
    }
  }
  const {data:manual}=await s.from('v1_curatorial_relationships').select('*,from:v1_artists!v1_curatorial_relationships_from_artist_id_fkey(ulan_id),to:v1_artists!v1_curatorial_relationships_to_artist_id_fkey(ulan_id)').eq('network_id',network.id).eq('active',true);
  for(const r of manual||[]){edges.set(`manual:${r.id}`,{from_ulan:r.from?.ulan_id,to_ulan:r.to?.ulan_id,family:r.normalized_family,directed:r.directed,visual_class:r.visual_class,source:'Manual',sources:['Manual'],note:r.note||null})}

  // Geography is deterministic and independent of Wikipedia:
  // active > death > birth > collaboration > unresolved.
  inferCollaborationGeography(artists,[...edges.values()]);
  return {network,artists,relationships:[...edges.values()]};
}

function snapshotHash(payload){
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
async function publishNetworkSnapshot(s,network){
  const payload=await graphPayload(s,network);
  const now=new Date().toISOString();
  const row={
    network_id:network.id,
    payload,
    artist_count:payload.artists.length,
    relationship_count:payload.relationships.length,
    content_hash:snapshotHash(payload),
    build_version:'1.1-rc8',
    published_at:now,
    updated_at:now
  };
  const {data,error}=await s.from('v1_published_networks')
    .upsert(row,{onConflict:'network_id'})
    .select('network_id,artist_count,relationship_count,content_hash,build_version,published_at')
    .single();
  if(error)throw error;
  return data;
}
async function publishedSnapshot(s,network){
  const {data,error}=await s.from('v1_published_networks')
    .select('payload,artist_count,relationship_count,content_hash,build_version,published_at')
    .eq('network_id',network.id)
    .maybeSingle();
  if(error)throw error;
  return data||null;
}

async function getSiteSetting(s,key,defaultValue=''){const {data,error}=await s.from('v1_site_settings').select('value').eq('key',key).maybeSingle();if(error)throw error;return data?.value??defaultValue}

module.exports=async function(req,res){
  const s=db(),action=String(req.query?.action||req.body?.action||'list-networks');
  const publicActions=new Set(['list-networks','graph','network-status','verify-token','site-settings']);
  if(action==='verify-token'){
    const configured=Boolean(configuredAdminToken());
    const ok=authorized(req);
    return res.status(ok?200:401).json({
      ok,
      configured,
      error:ok?null:(configured?'Admin token did not match the configured server token.':'No admin token is configured for this deployment.')
    });
  }
  if(!publicActions.has(action)&&!authorized(req))return res.status(401).json({
    error:'Invalid admin token',
    configured:Boolean(configuredAdminToken())
  });
  try{
    if(action==='site-settings')return res.status(200).json({methodology_text:await getSiteSetting(s,'methodology_text','')});
    if(action==='site-settings-update'){const value=String(req.body?.methodology_text||'').trim();const {error}=await s.from('v1_site_settings').upsert({key:'methodology_text',value,updated_at:new Date().toISOString()},{onConflict:'key'});if(error)throw error;return res.status(200).json({ok:true,methodology_text:value});}
    if(action==='list-networks')return res.status(200).json({networks:await listNetworks(s)});
    if(action==='create-network'){
      const b=req.body||{},name=String(b.name||'').trim(),slug=slugify(b.slug||name);if(!name||!slug)return res.status(400).json({error:'Network name is required'});
      const start=Number(b.start_year),end=Number(b.end_year);if(Number.isFinite(start)&&Number.isFinite(end)&&start>end)return res.status(400).json({error:'Start year must be before end year'});
      const payload={name,slug,public_label:String(b.public_label||name).trim(),description:String(b.description||'').trim()||null,start_year:Number.isFinite(start)?start:null,end_year:Number.isFinite(end)?end:null,geography_notes:String(b.geography_notes||'').trim()||null,role_filter:arr(b.role_filter),relationship_families:arr(b.relationship_families).length?arr(b.relationship_families):['training','influence','collaboration','association','family'],wikipedia_relationships_enabled:Boolean(b.wikipedia_relationships_enabled),max_depth:2,status:'draft'};
      const {data,error}=await s.from('v1_networks').insert(payload).select('*').single();if(error)throw error;return res.status(200).json({network:data});
    }
    if(action==='network-update'){
      const n=await networkBy(s,req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});const b=req.body||{},patch={updated_at:new Date().toISOString()};for(const k of ['name','public_label','description','start_year','end_year','geography_notes','role_filter','relationship_families','wikipedia_relationships_enabled','status'])if(Object.prototype.hasOwnProperty.call(b,k))patch[k]=b[k];const {data,error}=await s.from('v1_networks').update(patch).eq('id',n.id).select('*').single();if(error)throw error;const published=await republishIfRequested(s,data,Boolean(b.defer_publish));return res.status(200).json({network:data,published});
    }
    if(action==='resolve-ulan'){
      const resolved=await resolveInput(req.body?.input);if(!resolved.selected)return res.status(404).json({error:'No ULAN match',candidates:resolved.candidates});const profile=await fetchProfile(resolved.selected.ulan_id);return res.status(200).json({selected:resolved.selected,candidates:resolved.candidates,profile});
    }
    if(action==='admit-core'){
      const n=await networkBy(s,req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});
      const profile=await fetchProfile(req.body?.ulan_id),artist=await ensureArtistAndProfile(s,profile);
      const {error}=await s.from('v1_network_memberships').upsert({network_id:n.id,artist_id:artist.id,origin:'seed',graph_depth:0,automatic_tier:'core',manual_tier:'core',included:true,updated_at:new Date().toISOString()},{onConflict:'network_id,artist_id'});if(error)throw error;
      const stats=await upsertAssertions(s,artist,profile,n);
      const published=await republishIfRequested(s,n,Boolean(req.body?.defer_publish));
      return res.status(200).json({ok:true,artist,profile,stats,published});
    }
    if(action==='frontier'){
      const n=await networkBy(s,req.query?.network||req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});const depth=Number(req.query?.depth??req.body?.depth??0);const {data,error}=await s.from('v1_network_memberships').select('graph_depth,v1_artists!inner(id,canonical_name,ulan_id)').eq('network_id',n.id).eq('graph_depth',depth).eq('included',true);if(error)throw error;return res.status(200).json({network:n,depth,members:(data||[]).map(x=>x.v1_artists)});
    }
    if(action==='scan-member'){
      const n=await networkBy(s,req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});const profile=await fetchProfile(req.body?.ulan_id),artist=await ensureArtistAndProfile(s,profile);const stats=await upsertAssertions(s,artist,profile,n);return res.status(200).json({ok:true,artist:{id:artist.id,canonical_name:artist.canonical_name,ulan_id:artist.ulan_id},stats});
    }
    if(action==='list-candidates'){
      const n=await networkBy(s,req.query?.network||req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});let q=s.from('v1_network_candidates').select('*').eq('network_id',n.id).order('discovered_depth').order('preferred_name');if(req.query?.depth)q=q.eq('discovered_depth',Number(req.query.depth));const {data,error}=await q;if(error)throw error;return res.status(200).json({network:n,candidates:data||[]});
    }
    if(action==='resolve-candidate'){
      const n=await networkBy(s,req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});const ulan=String(req.body?.ulan_id||''),profile=await fetchProfile(ulan),scope=scopeStatus(n,profile);const {error}=await s.from('v1_network_candidates').update({preferred_name:profile.preferred_name||null,profile_snapshot:profile,scope_status:scope.status,decision_note:scope.reason,updated_at:new Date().toISOString()}).eq('network_id',n.id).eq('ulan_id',ulan);if(error)throw error;return res.status(200).json({profile,scope});
    }
    if(action==='curatorial-add'){
      const n=await networkBy(s,req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});
      const profile=await fetchProfile(req.body?.ulan_id),artist=await ensureArtistAndProfile(s,profile);
      const tier=['core','expanded','comprehensive'].includes(String(req.body?.tier||''))?String(req.body.tier):'expanded';
      const depth=tier==='core'?0:tier==='expanded'?1:2;
      const {error}=await s.from('v1_network_memberships').upsert({network_id:n.id,artist_id:artist.id,origin:'curatorial',graph_depth:depth,automatic_tier:tier,manual_tier:tier,included:true,curatorial_note:String(req.body?.note||'Curatorial network addition').trim(),updated_at:new Date().toISOString()},{onConflict:'network_id,artist_id'});if(error)throw error;
      const stats=await upsertAssertions(s,artist,profile,n);
      const published=await republishIfRequested(s,n,Boolean(req.body?.defer_publish));
      return res.status(200).json({ok:true,artist,tier,stats,published});
    }
    if(action==='admit-candidate'){
      const n=await networkBy(s,req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});const ulan=String(req.body?.ulan_id||'');const {data:c,error:cErr}=await s.from('v1_network_candidates').select('*').eq('network_id',n.id).eq('ulan_id',ulan).limit(1);if(cErr)throw cErr;if(!c?.length)return res.status(404).json({error:'Candidate not found'});if(c[0].scope_status!=='eligible'&&!req.body?.force)return res.status(409).json({error:`Candidate is ${c[0].scope_status}; use curatorial force admission only after review`});const profile=c[0].profile_snapshot?.ulan_id?c[0].profile_snapshot:await fetchProfile(ulan),artist=await ensureArtistAndProfile(s,profile),depth=Number(c[0].discovered_depth);const {error}=await s.from('v1_network_memberships').upsert({network_id:n.id,artist_id:artist.id,origin:req.body?.force?'curatorial':'ulan',graph_depth:depth,automatic_tier:tierForDepth(depth),included:true,curatorial_note:req.body?.force?String(req.body?.note||'Curatorial scope override'):null,updated_at:new Date().toISOString()},{onConflict:'network_id,artist_id'});if(error)throw error;await s.from('v1_network_candidates').update({scope_status:'admitted',updated_at:new Date().toISOString()}).eq('network_id',n.id).eq('ulan_id',ulan);const published=await republishIfRequested(s,n,Boolean(req.body?.defer_publish));return res.status(200).json({ok:true,artist,depth,tier:tierForDepth(depth),published});
    }
    if(action==='qualifiers'){
      const [{data:rules,error:rErr},{data:unknown,error:uErr}]=await Promise.all([s.from('v1_relationship_rules').select('*').order('raw_qualifier'),s.from('v1_unknown_qualifiers').select('*').order('seen_count',{ascending:false})]);if(rErr)throw rErr;if(uErr)throw uErr;
      const ulans=[...new Set((unknown||[]).flatMap(x=>[x.sample_focus_ulan,x.sample_counterpart_ulan]).filter(Boolean))];let names=[];
      if(ulans.length){const q=await s.from('v1_artists').select('ulan_id,canonical_name').in('ulan_id',ulans);if(q.error)throw q.error;names=q.data||[]}
      const nb=new Map(names.map(x=>[String(x.ulan_id),x.canonical_name]));
      return res.status(200).json({rules:rules||[],unknown:(unknown||[]).map(x=>({...x,sample_focus_name:nb.get(String(x.sample_focus_ulan))||null,sample_counterpart_name:nb.get(String(x.sample_counterpart_ulan))||null}))});
    }
    if(action==='map-qualifier'){
      const b=req.body||{},raw=normQ(b.raw_qualifier);if(!raw)return res.status(400).json({error:'Raw qualifier required'});const payload={raw_qualifier:raw,reciprocal_qualifier:normQ(b.reciprocal_qualifier)||null,normalized_family:String(b.normalized_family||'association'),direction_mode:String(b.direction_mode||'symmetric'),directed:Boolean(b.directed),visual_class:String(b.visual_class||'dotted'),expansion_eligible:Boolean(b.expansion_eligible),render_eligible:Boolean(b.render_eligible),getty_code:String(b.getty_code||'').trim()||null,notes:String(b.notes||'').trim()||null,active:true,updated_at:new Date().toISOString()};const {error}=await s.from('v1_relationship_rules').upsert(payload,{onConflict:'raw_qualifier'});if(error)throw error;await s.from('v1_unknown_qualifiers').delete().eq('raw_qualifier',raw);return res.status(200).json({ok:true,rule:payload,note:'Existing quarantined assertions remain quarantined until their focus ULAN records are rescanned.'});
    }
    if(action==='override-save'){
      const n=await networkBy(s,req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});const {data:a,error:aErr}=await s.from('v1_artists').select('*').eq('ulan_id',String(req.body?.ulan_id||'')).limit(1);if(aErr)throw aErr;if(!a?.length)return res.status(404).json({error:'Artist not found in v1'});const b=req.body||{},payload={network_id:n.id,artist_id:a[0].id,display_name:String(b.display_name||'').trim()||null,layout_year:Number.isFinite(Number(b.layout_year))?Number(b.layout_year):null,region:String(b.region||'').trim()||null,tier:['core','expanded','comprehensive'].includes(String(b.tier||''))?String(b.tier):null,note:String(b.note||'').trim()||null,updated_at:new Date().toISOString()};const {error}=await s.from('v1_curatorial_overrides').upsert(payload,{onConflict:'network_id,artist_id'});if(error)throw error;const published=await republishIfRequested(s,n,Boolean(req.body?.defer_publish));return res.status(200).json({ok:true,override:payload,published});
    }
    if(action==='manual-relationship-save'){
      const n=await networkBy(s,req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});const ids=[String(req.body?.from_ulan||''),String(req.body?.to_ulan||'')];const {data:a,error:aErr}=await s.from('v1_artists').select('*').in('ulan_id',ids);if(aErr)throw aErr;const by=new Map((a||[]).map(x=>[x.ulan_id,x]));if(!by.has(ids[0])||!by.has(ids[1]))return res.status(404).json({error:'Both artists must already exist in v1'});const {data,error}=await s.from('v1_curatorial_relationships').insert({network_id:n.id,from_artist_id:by.get(ids[0]).id,to_artist_id:by.get(ids[1]).id,normalized_family:String(req.body?.family||'association'),directed:Boolean(req.body?.directed),visual_class:String(req.body?.visual_class||'dotted'),note:String(req.body?.note||'').trim()||null}).select('*').single();if(error)throw error;const published=await republishIfRequested(s,n,Boolean(req.body?.defer_publish));return res.status(200).json({ok:true,relationship:data,published});
    }

    if(action==='wiki-relationship-members'){
      const n=await networkBy(s,req.query?.network||req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});
      return res.status(200).json({network:n,members:await wikiRelationshipMembers(s,n),status:await wikipediaRelationshipStatus(s,n)});
    }
    if(action==='wiki-relationship-scan-one'){
      const n=await networkBy(s,req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});
      return res.status(200).json(await scanWikipediaRelationshipsForArtist(s,n,String(req.body?.ulan_id||'')));
    }
    if(action==='wiki-relationship-run-finish'){
      const n=await networkBy(s,req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});
      const stats=req.body?.stats&&typeof req.body.stats==='object'?req.body.stats:{};
      const now=new Date().toISOString();
      const {data,error}=await s.from('v1_sync_runs').insert({network_id:n.id,run_type:'wikipedia_relationships',status:'applied',stats,changes:[],started_at:req.body?.started_at||now,completed_at:now,applied_at:now}).select('*').single();if(error)throw error;
      const published=await publishNetworkSnapshot(s,n);
      return res.status(200).json({ok:true,run:data,published});
    }
    if(action==='wiki-relationship-status'){
      const n=await networkBy(s,req.query?.network||req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});
      return res.status(200).json(await wikipediaRelationshipStatus(s,n));
    }
    if(action==='delete-network'){
      const n=await networkBy(s,req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});
      if(req.body?.confirm!==true)return res.status(400).json({error:'Explicit deletion confirmation is required'});
      const deleted=await deleteNetworkAndOrphans(s,n);
      return res.status(200).json({ok:true,network:{id:n.id,name:n.name,slug:n.slug},deleted});
    }

    if(action==='media-members'){
      const n=await networkBy(s,req.query?.network||req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});
      const {data,error}=await s.from('v1_network_memberships').select('artist_id,v1_artists!inner(id,canonical_name,ulan_id)').eq('network_id',n.id).eq('included',true);if(error)throw error;
      const ids=(data||[]).map(x=>x.artist_id);let media=[];if(ids.length){const mr=await s.from('v1_media_cache').select('*').in('artist_id',ids);if(mr.error)throw mr.error;media=mr.data||[]}
      const mb=new Map(media.map(x=>[x.artist_id,x]));return res.status(200).json({members:(data||[]).map(x=>({...x.v1_artists,media:mb.get(x.artist_id)||null}))});
    }
    if(action==='media-status'){
      const n=await networkBy(s,req.query?.network||req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});
      const {data:m,error:mErr}=await s.from('v1_network_memberships').select('artist_id').eq('network_id',n.id).eq('included',true);if(mErr)throw mErr;const ids=(m||[]).map(x=>x.artist_id);let rows=[];if(ids.length){const q=await s.from('v1_media_cache').select('artist_id,status,file_size_bytes,verified_at,next_check_at').in('artist_id',ids);if(q.error)throw q.error;rows=q.data||[]}
      const by={unresolved:0,valid:0,stale:0,invalid:0,no_image:0,missing:Math.max(0,ids.length-rows.length)};for(const x of rows)by[x.status]=(by[x.status]||0)+1;return res.status(200).json({counts:by,total:ids.length,used_bytes:await mediaUsage(s),cutoff_bytes:MEDIA_CUTOFF_BYTES});
    }
    if(action==='media-refresh-one'){
      const n=await networkBy(s,req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});const ulan=String(req.body?.ulan_id||'');
      const {data:a,error:aErr}=await s.from('v1_artists').select('id,canonical_name,ulan_id').eq('ulan_id',ulan).maybeSingle();if(aErr)throw aErr;if(!a)return res.status(404).json({error:'Artist not found'});
      const {data:membership,error:mErr}=await s.from('v1_network_memberships').select('artist_id').eq('network_id',n.id).eq('artist_id',a.id).eq('included',true).maybeSingle();if(mErr)throw mErr;if(!membership)return res.status(409).json({error:'Artist is not an included member of this network'});
      return res.status(200).json(await cacheWikipediaMedia(s,n,a,Boolean(req.body?.force)));
    }
    if(action==='network-status'){
      const n=await networkBy(s,req.query?.network||req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});
      const nets=(await listNetworks(s)).find(x=>x.id===n.id);
      const [{data:u},snap]=await Promise.all([
        s.from('v1_unknown_qualifiers').select('raw_qualifier,seen_count').order('seen_count',{ascending:false}),
        publishedSnapshot(s,n)
      ]);
      return res.status(200).json({
        network:n,counts:nets?.counts,total:nets?.total||0,unknown_qualifiers:u||[],
        published:snap?{
          artist_count:snap.artist_count,
          relationship_count:snap.relationship_count,
          content_hash:snap.content_hash,
          build_version:snap.build_version,
          published_at:snap.published_at
        }:null
      });
    }
    if(action==='publish-network'){
      const n=await networkBy(s,req.body?.network||req.query?.network);if(!n)return res.status(404).json({error:'Network not found'});
      const published=await publishNetworkSnapshot(s,n);
      return res.status(200).json({ok:true,published});
    }
    if(action==='graph'){
      const n=await networkBy(s,req.query?.network||req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});
      const snap=await publishedSnapshot(s,n);
      if(!snap)return res.status(409).json({error:'This network has not been published yet. Build the viewer snapshot in Admin first.',needs_publish:true});
      // Viewer path: one compact Supabase row. No profile joins, relationship
      // scans, or graph reconstruction occurs on a public page load.
      res.setHeader('Cache-Control','private, no-store, max-age=0');
      let payload=snap.payload;
      // Source policy is mutable independently of stored Wikipedia results.
      // A snapshot may have been built while Wikipedia relationships were ON,
      // so enforce the network's CURRENT policy at read time as a final gate.
      if(!n.wikipedia_relationships_enabled&&payload){
        const relationships=(payload.relationships||[]).flatMap(r=>{
          const sources=Array.isArray(r.sources)&&r.sources.length?r.sources:[r.source||'ULAN'];
          const kept=sources.filter(x=>x!=='Wikipedia');
          if(!kept.length)return [];
          return [{...r,
            source:r.source==='Wikipedia'?(kept[0]||'ULAN'):r.source,
            sources:kept,
            evidence:Array.isArray(r.evidence)?r.evidence.filter(e=>e?.source!=='Wikipedia'):r.evidence,
            wikipedia_evidence:undefined
          }];
        });
        payload={...payload,network:{...(payload.network||{}),wikipedia_relationships_enabled:false},relationships};
      }
      return res.status(200).json(payload);
    }
    return res.status(400).json({error:'Unknown v1 action'});
  }catch(e){return res.status(500).json({error:e.message||String(e)})}
};
