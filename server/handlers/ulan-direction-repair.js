const {createClient}=require('@supabase/supabase-js');
const {parseRelationships}=require('./low-countries-crawl.js')._test;
const PAGE=id=>`https://www.getty.edu/vow/ULANFullDisplay?find=&nation=&role=&subjectid=${id}`;
function db(){const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;if(!u||!k)throw new Error('Supabase admin configuration missing');return createClient(u,k,{auth:{persistSession:false}})}
function auth(req){return Boolean(process.env.WIKI_CRAWL_TOKEN)&&String(req.headers['x-crawl-token']||'')===process.env.WIKI_CRAWL_TOKEN}
function decodeHtml(s){return String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&ndash;|&#8211;/gi,'–').replace(/&mdash;|&#8212;/gi,'—').replace(/\s+/g,' ').trim()}
async function fetchText(id){const r=await fetch(PAGE(id),{headers:{'User-Agent':'TrecentoNetwork/0.20.21 ULAN direction repair'}});if(!r.ok)throw new Error(`ULAN ${id}: HTTP ${r.status}`);return decodeHtml(await r.text())}
function pairKey(a,b){return [String(a),String(b)].sort().join('|')}
function semanticClass(type){const t=String(type||'').toLowerCase();if(/student|teacher|apprentice|master|workshop|pupil/.test(t))return'workshop';if(/influenc/.test(t))return'influence';if(/employee/.test(t))return'workshop';if(/child|parent|grandchild|grandparent/.test(t))return'family';if(/worked with|partner|collaborated|associate|associated/.test(t))return'collab';return'other'}
function chooseFreshOrientation(relsA,relsB,a,b,wantedClass){
  const candidates=[];
  for(const rel of [...relsA,...relsB]){
    if(pairKey(rel.from,rel.to)!==pairKey(a,b))continue;
    if(wantedClass!=='other'&&semanticClass(rel.relationship_type)!==wantedClass)continue;
    candidates.push(rel);
  }
  if(!candidates.length)return {status:'not_found'};
  const sigs=new Map();
  for(const r of candidates){const k=`${r.from}|${r.to}|${Boolean(r.directed)}|${r.visual_class}`;if(!sigs.has(k))sigs.set(k,[]);sigs.get(k).push(r)}
  if(sigs.size!==1)return {status:'conflict',candidates};
  const only=candidates[0];
  return {status:'resolved',from:String(only.from),to:String(only.to),directed:Boolean(only.directed),visual_class:only.visual_class,candidates};
}
async function mapUlanIds(s,artists){
  const map=new Map();
  for(const a of artists||[])if(a.ulan_id)map.set(a.id,String(a.ulan_id));
  const missing=(artists||[]).filter(a=>!map.has(a.id)).map(a=>a.id);
  if(missing.length){const {data,error}=await s.from('external_ids').select('artist_id,external_id').eq('source','ULAN').in('artist_id',missing);if(error)throw error;for(const x of data||[])if(/^5\d{8}$/.test(String(x.external_id||''))&&!map.has(x.artist_id))map.set(x.artist_id,String(x.external_id))}
  return map;
}
module.exports=async function(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'POST required'});
  if(!auth(req))return res.status(401).json({error:'Invalid admin token'});
  try{
    const s=db();let trecento=0,low=0,skipped=0,conflicts=0,notFound=0;
    const [{data:arts,error:aErr},{data:rels,error:rErr},{data:evs,error:eErr}]=await Promise.all([
      s.from('artists').select('id,ulan_id'),
      s.from('relationships').select('id,from_artist_id,to_artist_id,relationship_type,directed,visual_class'),
      s.from('relationship_evidence').select('relationship_id,source').eq('source','ULAN')
    ]);if(aErr)throw aErr;if(rErr)throw rErr;if(eErr)throw eErr;
    const ulanByArtist=await mapUlanIds(s,arts||[]);
    const ulanBacked=new Set((evs||[]).map(e=>e.relationship_id));
    const targets=(rels||[]).filter(r=>ulanBacked.has(r.id)&&['workshop','influence','family','collab'].includes(semanticClass(r.relationship_type)));
    const needed=[...new Set(targets.flatMap(r=>[ulanByArtist.get(r.from_artist_id),ulanByArtist.get(r.to_artist_id)]).filter(Boolean))];
    const texts=new Map();
    let cursor=0;const workers=Array.from({length:Math.min(5,needed.length)},async()=>{while(cursor<needed.length){const i=cursor++,id=needed[i];try{texts.set(id,await fetchText(id))}catch(e){texts.set(id,null)}}});await Promise.all(workers);
    for(const r of targets){
      const a=ulanByArtist.get(r.from_artist_id),b=ulanByArtist.get(r.to_artist_id);if(!a||!b){skipped++;continue}
      const ta=texts.get(a),tb=texts.get(b);if(!ta&&!tb){skipped++;continue}
      const ra=ta?parseRelationships(ta,a):[],rb=tb?parseRelationships(tb,b):[];
      const fresh=chooseFreshOrientation(ra,rb,a,b,semanticClass(r.relationship_type));
      if(fresh.status==='conflict'){conflicts++;continue}if(fresh.status==='not_found'){notFound++;continue}
      const fromArtist=(arts||[]).find(x=>ulanByArtist.get(x.id)===fresh.from),toArtist=(arts||[]).find(x=>ulanByArtist.get(x.id)===fresh.to);if(!fromArtist||!toArtist){skipped++;continue}
      if(fromArtist.id!==r.from_artist_id||toArtist.id!==r.to_artist_id||Boolean(r.directed)!==fresh.directed||String(r.visual_class)!==String(fresh.visual_class)){
        const {error}=await s.from('relationships').update({from_artist_id:fromArtist.id,to_artist_id:toArtist.id,directed:fresh.directed,visual_class:fresh.visual_class}).eq('id',r.id);if(error)throw error;trecento++;
      }
    }
    // Low Countries records preserve the true focus record in source_url and were already normalized from raw ULAN wording.
    // Do not rewrite them in this Trecento hotfix; leave the known-good 0.20.19 result intact.
    return res.status(200).json({ok:true,trecento_rows_corrected:trecento,low_countries_rows_corrected:low,skipped,conflicts,not_found:notFound,method:'fresh endpoint ULAN reciprocal audit'});
  }catch(e){return res.status(500).json({error:e.message||String(e)})}
};
