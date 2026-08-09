const { createClient } = require("@supabase/supabase-js");

module.exports=async function handler(req,res){
  const url=process.env.SUPABASE_URL;
  const secret=process.env.SUPABASE_SECRET_KEY;
  if(!url||!secret) return res.status(500).json({error:"Supabase configuration missing"});

  const supabase=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

  const [
    {data:artists,error:aErr},
    {data:aliases,error:alErr},
    {data:external,error:xErr}
  ]=await Promise.all([
    supabase.from("artists")
      .select("id,canonical_name,ulan_id,layout_year,birth_year,death_year,floruit_start,floruit_end,region,entity_type,review_status,crawl_depth")
      .order("canonical_name"),
    supabase.from("artist_aliases").select("artist_id,alias"),
    supabase.from("external_ids").select("artist_id,source,external_id,url")
  ]);

  if(aErr) return res.status(500).json({error:aErr.message});
  if(alErr) return res.status(500).json({error:alErr.message});
  if(xErr) return res.status(500).json({error:xErr.message});

  const aliasMap=new Map();
  for(const row of aliases||[]){
    if(!aliasMap.has(row.artist_id)) aliasMap.set(row.artist_id,[]);
    aliasMap.get(row.artist_id).push(row.alias);
  }
  const extMap=new Map();
  for(const row of external||[]){
    if(!extMap.has(row.artist_id)) extMap.set(row.artist_id,[]);
    extMap.get(row.artist_id).push(row);
  }

  const active=(artists||[]).filter(a=>!String(a.review_status||"").startsWith("rejected"));
  res.status(200).json({
    target_total:250,
    discovery_window:{start:1270,end:1420},
    artists:active.map(a=>({
      ...a,
      aliases:aliasMap.get(a.id)||[],
      external_ids:extMap.get(a.id)||[]
    }))
  });
};
