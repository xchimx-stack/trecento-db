const {createClient}=require('@supabase/supabase-js');
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
  const wanted=arr(network.role_filter).map(x=>String(x).toLowerCase()).filter(Boolean);
  if(wanted.length){
    const roles=(profile.roles||[]).map(x=>String(x).toLowerCase());
    const hit=wanted.some(w=>roles.some(r=>r.includes(w)||w.includes(r)));
    if(!hit)return {status:'role_out',reason:`ULAN roles do not match network roles: ${(profile.roles||[]).join(', ')||'none'}`};
  }
  return {status:'eligible',reason:'Passes configured chronology/role scope'};
}
async function listNetworks(s){
  const {data,error}=await s.from('v1_networks').select('*').order('created_at');if(error)throw error;
  const out=[];for(const n of data||[]){const {data:m}=await s.from('v1_network_memberships').select('graph_depth,included').eq('network_id',n.id).eq('included',true);const counts={core:0,expanded:0,comprehensive:0};for(const x of m||[]){if(x.graph_depth===0)counts.core++;else if(x.graph_depth===1)counts.expanded++;else counts.comprehensive++}out.push({...n,counts,total:(m||[]).length})}return out;
}
async function graphPayload(s,network){
  const {data:members,error}=await s.from('v1_network_memberships').select('*,v1_artists(*),v1_curatorial_overrides(*)').eq('network_id',network.id).eq('included',true);if(error)throw error;
  const artistIds=(members||[]).map(m=>m.v1_artists?.id).filter(Boolean);
  let profiles=[],media=[];
  if(artistIds.length){
    const [pr,mr]=await Promise.all([
      s.from('v1_ulan_profiles').select('*').in('artist_id',artistIds),
      s.from('v1_media_cache').select('*').in('artist_id',artistIds)
    ]);
    if(pr.error)throw pr.error;if(mr.error)throw mr.error;
    profiles=pr.data||[];media=mr.data||[];
  }
  const profileBy=new Map(profiles.map(x=>[x.artist_id,x])),mediaBy=new Map(media.map(x=>[x.artist_id,x]));
  const artists=(members||[]).map(m=>{
    const a=m.v1_artists;
    const o=Array.isArray(m.v1_curatorial_overrides)?m.v1_curatorial_overrides.find(x=>x.network_id===network.id):null;
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
      storage_path:mc.storage_path||null,media_status:mc.status||null,
      media_last_verified:mc.verified_at||null
    };
  });
  const ulanSet=new Set(artists.map(a=>a.ulan_id).filter(Boolean));
  const {data:as,error:aErr}=await s.from('v1_ulan_relationship_assertions').select('*').eq('mapping_status','mapped');if(aErr)throw aErr;
  const edges=new Map();
  const allowedFamilies=new Set(arr(network.relationship_families));
  for(const r of as||[]){if(!r.render_eligible||!allowedFamilies.has(r.normalized_family)||!ulanSet.has(r.canonical_from_ulan)||!ulanSet.has(r.canonical_to_ulan))continue;const key=`${r.canonical_from_ulan}|${r.canonical_to_ulan}|${r.normalized_family}`;if(!edges.has(key))edges.set(key,{from_ulan:r.canonical_from_ulan,to_ulan:r.canonical_to_ulan,family:r.normalized_family,directed:r.directed,visual_class:r.visual_class,source:'ULAN',qualifiers:[]});const e=edges.get(key);if(!e.qualifiers.includes(r.raw_qualifier))e.qualifiers.push(r.raw_qualifier)}
  const {data:manual}=await s.from('v1_curatorial_relationships').select('*,from:v1_artists!v1_curatorial_relationships_from_artist_id_fkey(ulan_id),to:v1_artists!v1_curatorial_relationships_to_artist_id_fkey(ulan_id)').eq('network_id',network.id).eq('active',true);
  for(const r of manual||[]){edges.set(`manual:${r.id}`,{from_ulan:r.from?.ulan_id,to_ulan:r.to?.ulan_id,family:r.normalized_family,directed:r.directed,visual_class:r.visual_class,source:'Manual',note:r.note||null})}
  return {network,artists,relationships:[...edges.values()]};
}

module.exports=async function(req,res){
  const s=db(),action=String(req.query?.action||req.body?.action||'list-networks');
  const publicActions=new Set(['list-networks','graph','network-status','verify-token']);
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
    if(action==='list-networks')return res.status(200).json({networks:await listNetworks(s)});
    if(action==='create-network'){
      const b=req.body||{},name=String(b.name||'').trim(),slug=slugify(b.slug||name);if(!name||!slug)return res.status(400).json({error:'Network name is required'});
      const start=Number(b.start_year),end=Number(b.end_year);if(Number.isFinite(start)&&Number.isFinite(end)&&start>end)return res.status(400).json({error:'Start year must be before end year'});
      const payload={name,slug,public_label:String(b.public_label||name).trim(),description:String(b.description||'').trim()||null,start_year:Number.isFinite(start)?start:null,end_year:Number.isFinite(end)?end:null,geography_notes:String(b.geography_notes||'').trim()||null,methodology_text:String(b.methodology_text||'').trim()||null,role_filter:arr(b.role_filter),relationship_families:arr(b.relationship_families).length?arr(b.relationship_families):['training','influence','collaboration','association','family'],wikipedia_relationships_enabled:Boolean(b.wikipedia_relationships_enabled),max_depth:2,status:'draft'};
      const {data,error}=await s.from('v1_networks').insert(payload).select('*').single();if(error)throw error;return res.status(200).json({network:data});
    }
    if(action==='network-update'){
      const n=await networkBy(s,req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});const b=req.body||{},patch={updated_at:new Date().toISOString()};for(const k of ['name','public_label','description','start_year','end_year','geography_notes','methodology_text','role_filter','relationship_families','wikipedia_relationships_enabled','status'])if(Object.prototype.hasOwnProperty.call(b,k))patch[k]=b[k];const {data,error}=await s.from('v1_networks').update(patch).eq('id',n.id).select('*').single();if(error)throw error;return res.status(200).json({network:data});
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
    if(action==='network-status'){
      const n=await networkBy(s,req.query?.network||req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});const nets=(await listNetworks(s)).find(x=>x.id===n.id);const {data:u}=await s.from('v1_unknown_qualifiers').select('raw_qualifier,seen_count').order('seen_count',{ascending:false});return res.status(200).json({network:n,counts:nets?.counts,total:nets?.total||0,unknown_qualifiers:u||[]});
    }
    if(action==='graph'){
      const n=await networkBy(s,req.query?.network||req.body?.network);if(!n)return res.status(404).json({error:'Network not found'});return res.status(200).json(await graphPayload(s,n));
    }
    return res.status(400).json({error:'Unknown v1 action'});
  }catch(e){return res.status(500).json({error:e.message||String(e)})}
};
