const { createClient } = require("@supabase/supabase-js");

module.exports=async function handler(req,res){
  const url=process.env.SUPABASE_URL;
  const secret=process.env.SUPABASE_SECRET_KEY;
  if(!url||!secret) return res.status(500).json({error:"Supabase configuration missing"});

  const supabase=createClient(url,secret,{
    auth:{persistSession:false,autoRefreshToken:false}
  });

  const [
    {data:artists,error:aErr},
    {data:aliases,error:alErr},
    {data:external,error:xErr}
  ]=await Promise.all([
    supabase.from("artists")
      .select("id,canonical_name,ulan_id,layout_year,region,entity_type")
      .not("ulan_id","is",null)
      .order("canonical_name"),
    supabase.from("artist_aliases")
      .select("artist_id,alias"),
    supabase.from("external_ids")
      .select("artist_id,source,external_id,url")
  ]);

  if(aErr) return res.status(500).json({error:aErr.message});
  if(alErr) return res.status(500).json({error:alErr.message});
  if(xErr) return res.status(500).json({error:xErr.message});

  const aliasesByArtist=new Map();
  for(const a of aliases||[]){
    if(!aliasesByArtist.has(a.artist_id)) aliasesByArtist.set(a.artist_id,[]);
    aliasesByArtist.get(a.artist_id).push(a.alias);
  }

  const extByArtist=new Map();
  for(const x of external||[]){
    if(!extByArtist.has(x.artist_id)) extByArtist.set(x.artist_id,[]);
    extByArtist.get(x.artist_id).push(x);
  }

  res.status(200).json({
    artists:(artists||[]).map(a=>({
      ...a,
      aliases:aliasesByArtist.get(a.id)||[],
      external_ids:extByArtist.get(a.id)||[]
    }))
  });
};
