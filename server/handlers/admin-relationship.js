const {createClient}=require("@supabase/supabase-js");
const TYPES=new Set(["collaborated with","worked with","pupil of","student of","teacher of","master of","workshop of","influenced by","direct influence","influenced","child of","parent of","brother of","sibling of","proposed identity"]);
function db(){const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;if(!u||!k)throw new Error("Supabase admin configuration missing");return createClient(u,k,{auth:{persistSession:false}})}
module.exports=async function(req,res){
 if(req.method!=="POST")return res.status(405).json({error:"POST required"});
 if(!process.env.WIKI_CRAWL_TOKEN||String(req.headers["x-crawl-token"]||"")!==process.env.WIKI_CRAWL_TOKEN)return res.status(401).json({error:"Invalid admin token"});
 try{
  const fromUlan=String(req.body?.from_ulan||""),toUlan=String(req.body?.to_ulan||""),type=String(req.body?.relationship_type||"").trim(),note=String(req.body?.note||"").trim();
  if(!/^5\d{8}$/.test(fromUlan)||!/^5\d{8}$/.test(toUlan)||fromUlan===toUlan)return res.status(400).json({error:"Two different valid existing ULAN IDs are required"});
  if(!TYPES.has(type))return res.status(400).json({error:"Unsupported relationship type"});
  const s=db();
  const {data:arts,error}=await s.from("artists").select("id,canonical_name,ulan_id").in("ulan_id",[fromUlan,toUlan]);
  if(error)throw error;if((arts||[]).length!==2)return res.status(400).json({error:"Both ULAN IDs must already exist in the artist database"});
  const from=arts.find(x=>x.ulan_id===fromUlan),to=arts.find(x=>x.ulan_id===toUlan);
  const visual=type==="proposed identity"||type==="influenced by"||type==="influenced"?"dotted":type==="direct influence"?"dashed":"solid";
  const directed=!["collaborated with","worked with","brother of","sibling of","proposed identity"].includes(type);
  const {data:existing}=await s.from("relationships").select("*").eq("from_artist_id",from.id).eq("to_artist_id",to.id).eq("relationship_type",type).limit(1);
  let row;
  if(existing?.length){row=existing[0]}
  else{
    const {data,error:e}=await s.from("relationships").insert({from_artist_id:from.id,to_artist_id:to.id,relationship_type:type,visual_class:visual,directed,confidence:.95,review_status:"accepted"}).select("*").single();
    if(e)throw e;row=data;
  }
  const {error:ev}=await s.from("relationship_evidence").insert({relationship_id:row.id,source:"Manual",source_url:null,evidence_text:note||"Manual admin relationship override",confidence:.95,review_status:"accepted"});
  if(ev)throw ev;
  await s.from("admin_change_log").insert({artist_id:from.id,action:"relationship_edit",new_value:{from_ulan:fromUlan,to_ulan:toUlan,type},note});
  return res.status(200).json({ok:true,relationship_id:row.id,from:from.canonical_name,to:to.canonical_name,type});
 }catch(e){return res.status(500).json({error:e.message||String(e)})}
};
