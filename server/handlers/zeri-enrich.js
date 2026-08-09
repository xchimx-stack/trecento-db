const { createClient }=require("@supabase/supabase-js");
const zeri=require("./zeri-connections.js")._test;

function client(){
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) throw new Error("Supabase admin configuration missing");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
async function get(url){
  const r=await fetch(url,{headers:{"User-Agent":"TrecentoNetwork/0.17 Zeri facet enrichment"},redirect:"follow"});
  if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.text();
}
function authorized(req){return Boolean(process.env.WIKI_CRAWL_TOKEN)&&String(req.headers["x-crawl-token"]||"")===process.env.WIKI_CRAWL_TOKEN}

module.exports=async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({error:"POST required"});
  if(!authorized(req)) return res.status(401).json({error:"Invalid admin token"});
  try{
    const db=client();
    const artistId=Number(req.body?.artist_id);
    if(!Number.isFinite(artistId)) return res.status(400).json({error:"artist_id required"});
    const {data:artist,error:aErr}=await db.from("artists").select("id,canonical_name,ulan_id").eq("id",artistId).maybeSingle();
    if(aErr) throw aErr;if(!artist) return res.status(404).json({error:"Artist not found"});

    const [{data:rels,error:rErr},{data:ext,error:xErr}]=await Promise.all([
      db.from("relationships").select("from_artist_id,to_artist_id,review_status"),
      db.from("external_ids").select("artist_id,source,external_id,url")
    ]);
    if(rErr) throw rErr;if(xErr) throw xErr;
    const degree=(rels||[]).filter(r=>!String(r.review_status||"").startsWith("rejected")&&(r.from_artist_id===artist.id||r.to_artist_id===artist.id)).length;
    const threshold=degree>=25?7:degree>=12?5:3;
    const viaf=(ext||[]).find(x=>x.artist_id===artist.id&&x.source==="VIAF")?.external_id||null;
    if(!artist.ulan_id&&!viaf) return res.status(200).json({status:"no_authority",artist:artist.canonical_name,threshold,stored:0});

    const url=zeri.scopedSearchUrl(artist.canonical_name,1,100);
    const html=await get(url);
    const facet=zeri.extractOtherAttributionsFacet(html).filter(x=>x.count>=threshold);

    let stored=0,unresolved=0;
    for(const item of facet){
      const basis=await zeri.resolveZeriBasis(item.artist);
      const ulan=basis?.ulan_id||null, v=basis?.viaf_id||null;
      let related=null,identityBasis=null;
      if(ulan){
        const {data}=await db.from("artists").select("id,canonical_name").eq("ulan_id",ulan).maybeSingle();
        if(data){related=data;identityBasis="ULAN"}
      }
      if(!related&&v){
        const {data:ids}=await db.from("external_ids").select("artist_id").eq("source","VIAF").eq("external_id",v).limit(1);
        if(ids?.length){
          const {data}=await db.from("artists").select("id,canonical_name").eq("id",ids[0].artist_id).maybeSingle();
          if(data){related=data;identityBasis="VIAF"}
        }
      }
      if(!related||related.id===artist.id){unresolved++;continue}
      const payload={artist_id:artist.id,related_artist_id:related.id,attribution_count:item.count,threshold_used:threshold,identity_basis:identityBasis,source_url:url,updated_at:new Date().toISOString()};
      const {error}=await db.from("zeri_associations").upsert(payload,{onConflict:"artist_id,related_artist_id"});
      if(error) throw error;stored++;
    }
    return res.status(200).json({status:"ok",artist:artist.canonical_name,degree,threshold,facet_count:facet.length,stored,unresolved,source_url:url});
  }catch(e){return res.status(500).json({error:e.message||String(e)})}
};
