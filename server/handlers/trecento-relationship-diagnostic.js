const { createClient } = require('@supabase/supabase-js');
function client(){
  const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) throw new Error('Supabase admin environment variables are not configured.');
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
function norm(v){return String(v||'').trim().toLowerCase()}
module.exports=async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'POST required'});
  if(!process.env.WIKI_CRAWL_TOKEN || String(req.headers['x-crawl-token']||'')!==process.env.WIKI_CRAWL_TOKEN) return res.status(401).json({error:'Invalid admin token'});
  try{
    const aQ=norm(req.body?.artist_a),bQ=norm(req.body?.artist_b);
    if(!aQ||!bQ) return res.status(400).json({error:'Two artist names or ULAN IDs are required'});
    const db=client();
    const [artistsRes,relsRes,evRes]=await Promise.all([
      db.from('artists').select('id,canonical_name,ulan_id,review_status,merged_into_artist_id'),
      db.from('relationships').select('id,from_artist_id,to_artist_id,relationship_type,visual_class,directed,confidence,review_status'),
      db.from('relationship_evidence').select('relationship_id,source,source_url,evidence_text,confidence,review_status')
    ]);
    if(artistsRes.error) throw artistsRes.error;if(relsRes.error) throw relsRes.error;if(evRes.error) throw evRes.error;
    const artists=(artistsRes.data||[]).filter(x=>!String(x.review_status||'').startsWith('rejected')&&!x.merged_into_artist_id);
    const find=q=>artists.filter(x=>norm(x.ulan_id)===q||norm(x.canonical_name)===q||norm(x.canonical_name).includes(q)).slice(0,8);
    const aa=find(aQ),bb=find(bQ);
    if(!aa.length||!bb.length) return res.status(404).json({error:'Could not match one or both artists',artist_a_matches:aa,artist_b_matches:bb});
    const evByRel=new Map();for(const e of evRes.data||[]){if(!evByRel.has(e.relationship_id))evByRel.set(e.relationship_id,[]);evByRel.get(e.relationship_id).push(e)}
    const pairs=[];
    for(const a of aa)for(const b of bb){
      const rows=(relsRes.data||[]).filter(r=>(r.from_artist_id===a.id&&r.to_artist_id===b.id)||(r.from_artist_id===b.id&&r.to_artist_id===a.id));
      pairs.push({artist_a:a,artist_b:b,relationship_rows:rows.map(r=>({...r,evidence:evByRel.get(r.id)||[]}))});
    }
    return res.status(200).json({ok:true,pairs});
  }catch(e){return res.status(500).json({error:e.message||String(e)})}
};
