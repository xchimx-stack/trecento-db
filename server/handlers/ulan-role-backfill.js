const {createClient}=require("@supabase/supabase-js");
const PAGE=id=>`https://www.getty.edu/vow/ULANFullDisplay?find=&nation=&role=&subjectid=${id}`;
function db(){const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;if(!u||!k)throw new Error("Supabase admin configuration missing");return createClient(u,k,{auth:{persistSession:false}})}
function auth(req){return Boolean(process.env.WIKI_CRAWL_TOKEN)&&String(req.headers["x-crawl-token"]||"")===process.env.WIKI_CRAWL_TOKEN}
function decode(s){return String(s||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g," ").trim()}
function extractRoles(text){
  const m=String(text||"").match(/\bRoles:\s*([\s\S]*?)(?=\bGender:\s*|\bBirth and Death Places:\s*|\bEvents:\s*|\bRelated People or Corporate Bodies:\s*|\bBiographies:\s*|$)/i);
  if(!m)return "";
  return m[1].replace(/\.{2,}/g," ").replace(/\s+/g," ").trim().slice(0,1000);
}
async function resolveUlanForArtist(s,a){
  if(a?.ulan_id)return String(a.ulan_id);
  const {data,error}=await s.from("external_ids").select("external_id").eq("artist_id",a.id).eq("source","ULAN").limit(1);
  if(error)throw error;
  return data?.[0]?.external_id?String(data[0].external_id):null;
}
module.exports=async function(req,res){
  if(req.method!=="POST")return res.status(405).json({error:"POST required"});
  if(!auth(req))return res.status(401).json({error:"Invalid admin token"});
  try{
    const s=db(),mode=String(req.body?.mode||"list");
    if(mode==="list"){
      const [{data:artists,error:ae},{data:ext,error:ee}]=await Promise.all([
        s.from("artists").select("id,canonical_name,ulan_id,ulan_roles,review_status").not("review_status","like","rejected%").order("canonical_name"),
        s.from("external_ids").select("artist_id,external_id").eq("source","ULAN")
      ]);
      if(ae)throw ae;if(ee)throw ee;
      const extBy=new Map((ext||[]).map(x=>[x.artist_id,String(x.external_id)]));
      const out=(artists||[]).map(a=>({...a,resolved_ulan_id:a.ulan_id||extBy.get(a.id)||null})).filter(a=>a.resolved_ulan_id);
      return res.status(200).json({artists:out});
    }
    if(mode==="one"){
      const id=String(req.body?.artist_id||"");
      const {data:a,error}=await s.from("artists").select("id,canonical_name,ulan_id").eq("id",id).maybeSingle();
      if(error)throw error;if(!a)return res.status(404).json({error:"Artist not found"});
      const ulan=await resolveUlanForArtist(s,a);
      if(!ulan)return res.status(400).json({error:"Artist has no ULAN ID"});
      const r=await fetch(PAGE(ulan),{headers:{"User-Agent":"TrecentoNetwork/0.20.20 ULAN role backfill"}});
      if(!r.ok)throw new Error(`ULAN ${r.status}`);
      const text=decode(await r.text());
      const roles=extractRoles(text);
      const {error:u}=await s.from("artists").update({ulan_roles:roles||null,ulan_id:a.ulan_id||ulan}).eq("id",a.id);
      if(u)throw u;
      return res.status(200).json({ok:true,artist_id:a.id,name:a.canonical_name,ulan_id:ulan,roles:roles||null});
    }
    return res.status(400).json({error:"Unknown mode"});
  }catch(e){return res.status(500).json({error:e.message||String(e)})}
};
module.exports._test={decode,extractRoles};
