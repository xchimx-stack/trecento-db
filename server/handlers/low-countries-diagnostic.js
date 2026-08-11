const { createClient } = require('@supabase/supabase-js');

function client(){
  const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) throw new Error('Supabase admin environment variables are not configured.');
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
function tierFor(row,kind){
  if(kind==='seed') return 'core';
  return Number(row?.crawl_depth)===2?'comprehensive':'expanded';
}
function tierRank(t){return t==='core'?1:t==='expanded'?2:3}
function norm(s){return String(s||'').trim().toLowerCase()}

module.exports=async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'POST required'});
  if(!process.env.WIKI_CRAWL_TOKEN || String(req.headers['x-crawl-token']||'')!==process.env.WIKI_CRAWL_TOKEN){
    return res.status(401).json({error:'Invalid admin token'});
  }
  try{
    const q=norm(req.body?.query);
    if(!q) return res.status(400).json({error:'Artist name or ULAN ID required'});
    const db=client();
    const [seedRes,candRes,edgeRes]=await Promise.all([
      db.from('network_seed_queue').select('*').eq('network_id','low_countries').not('ulan_id','is',null),
      db.from('low_countries_candidates').select('*'),
      db.from('low_countries_network_edges').select('*')
    ]);
    if(seedRes.error) throw seedRes.error;
    if(candRes.error) throw candRes.error;
    if(edgeRes.error) throw edgeRes.error;

    const records=[];
    const byUlan=new Map();
    for(const s of seedRes.data||[]){
      const ulan=String(s.ulan_id||''); if(!ulan) continue;
      const rec={kind:'seed',ulan_id:ulan,name:s.preferred_name||s.seed_name||ulan,seed_name:s.seed_name||null,city:s.geography_bucket||'Unknown',tier:tierFor(s,'seed'),crawl_depth:0,review_status:s.status||null,birth_year:s.birth_year??null,death_year:s.death_year??null,birth_place:s.birth_place||null,death_place:s.death_place||null,active_place:s.active_place||null,geography_source:s.geography_source||null,raw:s};
      records.push(rec); byUlan.set(ulan,rec);
    }
    for(const c of candRes.data||[]){
      const ulan=String(c.ulan_id||''); if(!ulan) continue;
      // A seed record is authoritative for tier if the same ULAN appears in both tables.
      if(byUlan.has(ulan)) continue;
      const rec={kind:'candidate',ulan_id:ulan,name:c.preferred_name||c.discovered_label||ulan,seed_name:c.discovered_label||null,city:c.geography_bucket||'Unknown',tier:tierFor(c,'candidate'),crawl_depth:Number(c.crawl_depth)||1,review_status:c.review_status||null,birth_year:c.birth_year??null,death_year:c.death_year??null,birth_place:c.birth_place||null,death_place:c.death_place||null,active_place:c.active_place||null,geography_source:c.geography_source||null,raw:c};
      records.push(rec); byUlan.set(ulan,rec);
    }

    const exact=records.filter(r=>norm(r.ulan_id)===q || norm(r.name)===q || norm(r.seed_name)===q);
    const partial=records.filter(r=>norm(r.name).includes(q)||norm(r.seed_name).includes(q)||norm(r.ulan_id).includes(q));
    const matches=(exact.length?exact:partial).slice(0,12);
    if(!matches.length) return res.status(404).json({error:'No Low Countries artist matched that query.'});

    const results=matches.map(artist=>{
      const incident=(edgeRes.data||[]).filter(e=>String(e.from_ulan_id||'')===artist.ulan_id||String(e.to_ulan_id||'')===artist.ulan_id);
      const relationships=incident.map(e=>{
        const outgoing=String(e.from_ulan_id||'')===artist.ulan_id;
        const counterpartUlan=outgoing?String(e.to_ulan_id||''):String(e.from_ulan_id||'');
        const other=byUlan.get(counterpartUlan)||null;
        const artistRank=tierRank(artist.tier),otherRank=other?tierRank(other.tier):99;
        const needed=Math.max(artistRank,otherRank);
        return {
          edge_id:e.id??null,
          direction:outgoing?'outgoing':'incoming',
          from_ulan_id:String(e.from_ulan_id||''),
          to_ulan_id:String(e.to_ulan_id||''),
          relationship_type:e.relationship_type||null,
          visual_class:e.visual_class||null,
          directed:Boolean(e.directed),
          source_depth:e.source_depth??null,
          counterpart:{ulan_id:counterpartUlan,name:other?.name||'(ULAN not present in loaded artist set)',city:other?.city||null,tier:other?.tier||null,crawl_depth:other?.crawl_depth??null,review_status:other?.review_status||null},
          eligible:{core:needed<=1,expanded:needed<=2,comprehensive:needed<=3},
          graph_artist_present:Boolean(other)
        };
      });
      const uniqueCounterparts=new Set(relationships.filter(r=>r.graph_artist_present).map(r=>r.counterpart.ulan_id));
      return {
        artist:{ulan_id:artist.ulan_id,name:artist.name,kind:artist.kind,city:artist.city,tier:artist.tier,crawl_depth:artist.crawl_depth,review_status:artist.review_status,birth_year:artist.birth_year,death_year:artist.death_year,birth_place:artist.birth_place,death_place:artist.death_place,active_place:artist.active_place,geography_source:artist.geography_source},
        stored_relationship_rows:relationships.length,
        graph_eligible_degree:uniqueCounterparts.size,
        eligible_degree_by_tier:{
          core:new Set(relationships.filter(r=>r.eligible.core&&r.graph_artist_present).map(r=>r.counterpart.ulan_id)).size,
          expanded:new Set(relationships.filter(r=>r.eligible.expanded&&r.graph_artist_present).map(r=>r.counterpart.ulan_id)).size,
          comprehensive:new Set(relationships.filter(r=>r.eligible.comprehensive&&r.graph_artist_present).map(r=>r.counterpart.ulan_id)).size
        },
        relationships
      };
    });
    return res.status(200).json({ok:true,query:req.body?.query,match_count:results.length,results});
  }catch(e){return res.status(500).json({error:e.message||String(e)});}
};
