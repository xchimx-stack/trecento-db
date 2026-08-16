const {createClient}=require('@supabase/supabase-js');
const crypto=require('node:crypto');
const {fetchProfile,resolveInput}=require('./ulan.js');
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
const MEDIA_CUTOFF_BYTES=Math.floor(MEDIA_DEFAULT_CAP_BYTES*0.50);
const MEDIA_MAX_FILE_BYTES=2*1024*1024;
const MEDIA_RECHECK_DAYS=90;
function isoAfterDays(days){return new Date(Date.now()+days*86400000).toISOString()}
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
  const host=lang==='commons'?'commons.wikimedia.org':`${lang}.wikipedia.org`;const u=new URL(`https://${host}/w/api.php`);u.searchParams.set('action','query');u.searchParams.set('format','json');u.searchParams.set('formatversion','2');
  for(const [k,v] of Object.entries(params))if(v!==undefined&&v!==null)u.searchParams.set(k,String(v));
  const r=await fetch(u,{headers:{'User-Agent':'ArtNetworkViewer/1.0.12 (cache refresh; educational project)'}});if(!r.ok)throw new Error(`Wikipedia ${lang} ${r.status}`);return r.json();
}
function usableWikiPage(page,name){return page&&page.ns===0&&!page.missing&&mediaNameScore(name,page.title)>=0.55}
function wikidataClaimValues(entity,property){
  const claims=entity?.claims?.[property]||[];
  return claims.map(c=>c?.mainsnak?.datavalue?.value).filter(v=>typeof v==='string').map(String);
}
async function wikidataApi(params){
  const u=new URL('https://www.wikidata.org/w/api.php');
  u.searchParams.set('format','json');u.searchParams.set('formatversion','2');u.searchParams.set('origin','*');
  for(const [k,v] of Object.entries(params))if(v!==undefined&&v!==null)u.searchParams.set(k,String(v));
  const r=await fetch(u,{headers:{Accept:'application/json','User-Agent':'ArtNetworkViewer/1.0.12 authority resolver'}});
  if(!r.ok)throw new Error(`Wikidata API ${r.status}`);return r.json();
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
  const id=String(ulanId||'').trim();if(!/^\d+$/.test(id)){trace.push('ULAN ID missing/invalid');return null}
  // 1) Normal Wikidata search endpoint with a structured CirrusSearch query.
  // This avoids WDQS/SPARQL throttling and then validates P245 on the entity.
  for(const q of [`haswbstatement:P245=${id}`,`haswbstatement:P245:${id}`]){
    try{
      const d=await wikidataApi({action:'query',list:'search',srsearch:q,srnamespace:0,srlimit:10});
      const qids=(d?.query?.search||[]).map(x=>x.title).filter(x=>/^Q\d+$/.test(String(x)));
      for(const e of await wikidataEntities(qids)){
        if(wikidataClaimValues(e,'P245').includes(id)){trace.push(`ULAN ${id} → ${e.id} via Wikidata property search`);return e}
      }
    }catch(e){trace.push(`Wikidata property search failed: ${e.message}`)}
  }
  // 2) Search Wikidata by several normalized name forms, but accept a candidate
  // only when its P245 claim exactly equals the Getty ULAN ID.
  for(const variant of mediaNameVariants(name)){
    for(const lang of ['en','de','it','fr','nl']){
      try{
        const d=await wikidataApi({action:'wbsearchentities',search:variant,language:lang,uselang:'en',type:'item',limit:10});
        const qids=(d?.search||[]).map(x=>x.id).filter(Boolean);
        for(const e of await wikidataEntities(qids)){
          if(wikidataClaimValues(e,'P245').includes(id)){trace.push(`ULAN ${id} → ${e.id} via validated name search (${lang}: ${variant})`);return e}
        }
      }catch(e){trace.push(`Wikidata name search failed (${lang}): ${e.message}`)}
    }
  }
  trace.push(`No Wikidata entity with P245=${id} found`);return null;
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
  try{
    const d=await wikiQuery(lang,{titles:pageTitle,prop:'images',imlimit:100});
    const images=(d?.query?.pages?.[0]?.images||[]).map(x=>x.title).filter(bodyImageCandidate);
    if(!images.length)return null;
    const rotated=[...images.slice(stableChoiceIndex(seed,images.length)),...images.slice(0,stableChoiceIndex(seed,images.length))].slice(0,16);
    const info=await wikiQuery('commons',{titles:rotated.join('|'),prop:'imageinfo',iiprop:'url|mime',iiurlwidth:640});
    const byTitle=new Map((info?.query?.pages||[]).map(p=>[p.title,p]));
    for(const title of rotated){const ii=byTitle.get(title)?.imageinfo?.[0],url=ii?.thumburl||ii?.url;if(url&&/^image\/(jpeg|png|webp)/i.test(ii?.mime||'image/jpeg'))return {url,title}}
  }catch{}
  return null;
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
      try{
        const d=await wikiQuery('en',{titles:enTitle,redirects:1,prop:'info|pageprops',inprop:'url'}),page=(d?.query?.pages||[])[0];
        if(page&&!page.missing){const r=await resolvedPageMedia('en',page,name,'ulan_wikidata_enwiki',qid,seed);r.resolution_trace=trace;return r}
        trace.push(`English Wikipedia page missing for ${enTitle}`);
      }catch(e){trace.push(`English Wikipedia fetch failed: ${e.message}`)}
    }else trace.push(`${qid} has no English Wikipedia sitelink`);
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
  let status=source?'valid':'no_image';
  if(source){
    const used=await mediaUsage(s);
    if(used-fileSize<MEDIA_CUTOFF_BYTES){
      try{
        const rr=await fetch(source,{headers:{'User-Agent':'ArtNetworkViewer/1.0.12 media cache'}});
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
  const payload={artist_id:artist.id,wikipedia_url:resolved.wikipedia_url,wikipedia_language:resolved.language,wikidata_id:resolved.wikidata_id,thumbnail_source_url:resolved.thumbnail_source_url,storage_path:storagePath,file_size_bytes:fileSize||null,source_page_url:resolved.wikipedia_url,status,resolved_at:existing?.resolved_at||stamp,verified_at:stamp,next_check_at:isoAfterDays(MEDIA_RECHECK_DAYS),source_hash:sourceHash,updated_at:stamp};
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
  const ns=Number(network.start_year),ne=Number(network.end_year),ps=Number(profile.period_start),pe=Number(profile.period_end||profile.period_start);
  if(Number.isFinite(ns)&&Number.isFinite(ne)){
    if(!Number.isFinite(ps))return {status:'unresolved',reason:'ULAN chronology unresolved'};
    if((Number.isFinite(pe)?pe:ps)<ns||ps>ne)return {status:'chronology_out',reason:`ULAN chronology ${ps}${pe&&pe!==ps?`–${pe}`:''} is outside ${ns}–${ne}`};
  }
  if(profile.record_type && !/^person$/i.test(String(profile.record_type))) return {status:'role_out',reason:`ULAN record type ${profile.record_type} is not a person`};
  // ULAN roles are descriptive and normalized for viewer filtering; they are not an admission gate.
  return {status:'eligible',reason:'Passes configured chronology/role scope'};
}
async function listNetworks(s){
  const {data,error}=await s.from('v1_networks').select('*').order('created_at');if(error)throw error;
  const out=[];for(const n of data||[]){const {data:m}=await s.from('v1_network_memberships').select('graph_depth,included').eq('network_id',n.id).eq('included',true);const counts={core:0,expanded:0,comprehensive:0};for(const x of m||[]){if(x.graph_depth===0)counts.core++;else if(x.graph_depth===1)counts.expanded++;else counts.comprehensive++}out.push({...n,counts,total:(m||[]).length})}return out;
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
    const active=Array.isArray(pr.active_places)?pr.active_places.filter(Boolean):[];
    const autoRegion=active[0]||pr.death_place||pr.birth_place||null;
    return {
      id:a.id,ulan_id:a.ulan_id,canonical_name:o?.display_name||a.canonical_name,
      tier:o?.tier||m.manual_tier||m.automatic_tier,graph_depth:m.graph_depth,origin:m.origin,
      layout_year:o?.layout_year??autoYear,region:o?.region||autoRegion,
      roles:Array.isArray(pr.roles)?pr.roles:[],roles_raw:pr.roles_raw||null,
      period_start:pr.period_start??null,period_end:pr.period_end??null,
      birth_place:pr.birth_place||null,death_place:pr.death_place||null,active_places:active,
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
  for(const r of assertionRows){if(!r.render_eligible||!allowedFamilies.has(r.normalized_family)||!ulanSet.has(r.canonical_from_ulan)||!ulanSet.has(r.canonical_to_ulan))continue;const key=`${r.canonical_from_ulan}|${r.canonical_to_ulan}|${r.normalized_family}`;if(!edges.has(key))edges.set(key,{from_ulan:r.canonical_from_ulan,to_ulan:r.canonical_to_ulan,family:r.normalized_family,directed:r.directed,visual_class:r.visual_class,source:'ULAN',qualifiers:[]});const e=edges.get(key);if(!e.qualifiers.includes(r.raw_qualifier))e.qualifiers.push(r.raw_qualifier)}
  const {data:manual}=await s.from('v1_curatorial_relationships').select('*,from:v1_artists!v1_curatorial_relationships_from_artist_id_fkey(ulan_id),to:v1_artists!v1_curatorial_relationships_to_artist_id_fkey(ulan_id)').eq('network_id',network.id).eq('active',true);
  for(const r of manual||[]){edges.set(`manual:${r.id}`,{from_ulan:r.from?.ulan_id,to_ulan:r.to?.ulan_id,family:r.normalized_family,directed:r.directed,visual_class:r.visual_class,source:'Manual',note:r.note||null})}
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
    build_version:'1.0.7',
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
      const n=await networkBy(s,req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});const b=req.body||{},patch={updated_at:new Date().toISOString()};for(const k of ['name','public_label','description','start_year','end_year','geography_notes','role_filter','relationship_families','wikipedia_relationships_enabled','status'])if(Object.prototype.hasOwnProperty.call(b,k))patch[k]=b[k];const {data,error}=await s.from('v1_networks').update(patch).eq('id',n.id).select('*').single();if(error)throw error;return res.status(200).json({network:data});
    }
    if(action==='resolve-ulan'){
      const resolved=await resolveInput(req.body?.input);if(!resolved.selected)return res.status(404).json({error:'No ULAN match',candidates:resolved.candidates});const profile=await fetchProfile(resolved.selected.ulan_id);return res.status(200).json({selected:resolved.selected,candidates:resolved.candidates,profile});
    }
    if(action==='admit-core'){
      const n=await networkBy(s,req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});const profile=await fetchProfile(req.body?.ulan_id),artist=await ensureArtistAndProfile(s,profile);const {error}=await s.from('v1_network_memberships').upsert({network_id:n.id,artist_id:artist.id,origin:'seed',graph_depth:0,automatic_tier:'core',included:true,updated_at:new Date().toISOString()},{onConflict:'network_id,artist_id'});if(error)throw error;return res.status(200).json({ok:true,artist,profile});
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
      return res.status(200).json({ok:true,artist,tier,stats});
    }
    if(action==='admit-candidate'){
      const n=await networkBy(s,req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});const ulan=String(req.body?.ulan_id||'');const {data:c,error:cErr}=await s.from('v1_network_candidates').select('*').eq('network_id',n.id).eq('ulan_id',ulan).limit(1);if(cErr)throw cErr;if(!c?.length)return res.status(404).json({error:'Candidate not found'});if(c[0].scope_status!=='eligible'&&!req.body?.force)return res.status(409).json({error:`Candidate is ${c[0].scope_status}; use curatorial force admission only after review`});const profile=c[0].profile_snapshot?.ulan_id?c[0].profile_snapshot:await fetchProfile(ulan),artist=await ensureArtistAndProfile(s,profile),depth=Number(c[0].discovered_depth);const {error}=await s.from('v1_network_memberships').upsert({network_id:n.id,artist_id:artist.id,origin:req.body?.force?'curatorial':'ulan',graph_depth:depth,automatic_tier:tierForDepth(depth),included:true,curatorial_note:req.body?.force?String(req.body?.note||'Curatorial scope override'):null,updated_at:new Date().toISOString()},{onConflict:'network_id,artist_id'});if(error)throw error;await s.from('v1_network_candidates').update({scope_status:'admitted',updated_at:new Date().toISOString()}).eq('network_id',n.id).eq('ulan_id',ulan);return res.status(200).json({ok:true,artist,depth,tier:tierForDepth(depth)});
    }
    if(action==='qualifiers'){
      const [{data:rules,error:rErr},{data:unknown,error:uErr}]=await Promise.all([s.from('v1_relationship_rules').select('*').order('raw_qualifier'),s.from('v1_unknown_qualifiers').select('*').order('seen_count',{ascending:false})]);if(rErr)throw rErr;if(uErr)throw uErr;return res.status(200).json({rules:rules||[],unknown:unknown||[]});
    }
    if(action==='map-qualifier'){
      const b=req.body||{},raw=normQ(b.raw_qualifier);if(!raw)return res.status(400).json({error:'Raw qualifier required'});const payload={raw_qualifier:raw,reciprocal_qualifier:normQ(b.reciprocal_qualifier)||null,normalized_family:String(b.normalized_family||'association'),direction_mode:String(b.direction_mode||'symmetric'),directed:Boolean(b.directed),visual_class:String(b.visual_class||'dotted'),expansion_eligible:Boolean(b.expansion_eligible),render_eligible:Boolean(b.render_eligible),getty_code:String(b.getty_code||'').trim()||null,notes:String(b.notes||'').trim()||null,active:true,updated_at:new Date().toISOString()};const {error}=await s.from('v1_relationship_rules').upsert(payload,{onConflict:'raw_qualifier'});if(error)throw error;await s.from('v1_unknown_qualifiers').delete().eq('raw_qualifier',raw);return res.status(200).json({ok:true,rule:payload,note:'Existing quarantined assertions remain quarantined until their focus ULAN records are rescanned.'});
    }
    if(action==='override-save'){
      const n=await networkBy(s,req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});const {data:a,error:aErr}=await s.from('v1_artists').select('*').eq('ulan_id',String(req.body?.ulan_id||'')).limit(1);if(aErr)throw aErr;if(!a?.length)return res.status(404).json({error:'Artist not found in v1'});const b=req.body||{},payload={network_id:n.id,artist_id:a[0].id,display_name:String(b.display_name||'').trim()||null,layout_year:Number.isFinite(Number(b.layout_year))?Number(b.layout_year):null,region:String(b.region||'').trim()||null,tier:['core','expanded','comprehensive'].includes(String(b.tier||''))?String(b.tier):null,note:String(b.note||'').trim()||null,updated_at:new Date().toISOString()};const {error}=await s.from('v1_curatorial_overrides').upsert(payload,{onConflict:'network_id,artist_id'});if(error)throw error;return res.status(200).json({ok:true,override:payload});
    }
    if(action==='manual-relationship-save'){
      const n=await networkBy(s,req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});const ids=[String(req.body?.from_ulan||''),String(req.body?.to_ulan||'')];const {data:a,error:aErr}=await s.from('v1_artists').select('*').in('ulan_id',ids);if(aErr)throw aErr;const by=new Map((a||[]).map(x=>[x.ulan_id,x]));if(!by.has(ids[0])||!by.has(ids[1]))return res.status(404).json({error:'Both artists must already exist in v1'});const {data,error}=await s.from('v1_curatorial_relationships').insert({network_id:n.id,from_artist_id:by.get(ids[0]).id,to_artist_id:by.get(ids[1]).id,normalized_family:String(req.body?.family||'association'),directed:Boolean(req.body?.directed),visual_class:String(req.body?.visual_class||'dotted'),note:String(req.body?.note||'').trim()||null}).select('*').single();if(error)throw error;return res.status(200).json({ok:true,relationship:data});
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
      res.setHeader('Cache-Control','public, s-maxage=30, stale-while-revalidate=120');
      return res.status(200).json(snap.payload);
    }
    return res.status(400).json({error:'Unknown v1 action'});
  }catch(e){return res.status(500).json({error:e.message||String(e)})}
};
