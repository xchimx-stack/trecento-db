import { createClient } from "@supabase/supabase-js";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY;
if(!url||!secret){
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY");
  process.exit(1);
}

const supabase=createClient(url,secret,{
  auth:{persistSession:false,autoRefreshToken:false}
});

const JOB_SOURCE="Identity collision repair v1";

const {data:done,error:doneErr}=await supabase
  .from("crawl_runs")
  .select("id")
  .eq("source",JOB_SOURCE)
  .eq("status","completed")
  .limit(1);
if(doneErr) throw doneErr;

if(done?.length){
  console.log("Identity collision repair already completed; skipping.");
  process.exit(0);
}

const {data:run,error:runErr}=await supabase
  .from("crawl_runs")
  .insert({source:JOB_SOURCE,status:"running"})
  .select("id").single();
if(runErr) throw runErr;

let repairs=0;
let migratedRelationships=0;
let rejectedRelationships=0;

// Known identity correction.
const GOOD_ULAN="500012251"; // Giovanni da Milano, Italian painter, active 1346-1369
const BAD_ULAN="500029803";  // Giovanni da Milano, Italian engineer, died 1451

const {data:goodExisting,error:gErr}=await supabase
  .from("artists")
  .select("*")
  .eq("ulan_id",GOOD_ULAN)
  .maybeSingle();
if(gErr) throw gErr;

let good=goodExisting;

if(!good){
  const {data:inserted,error:iErr}=await supabase
    .from("artists")
    .insert({
      canonical_name:"Giovanni da Milano",
      entity_type:"person",
      ulan_id:GOOD_ULAN,
      floruit_start:1346,
      floruit_end:1369,
      layout_year:1358,
      region:"Florence",
      region_confidence:0.85,
      chronology_confidence:0.95,
      visibility_score:0,
      default_visible:false,
      review_status:"accepted",
      crawl_depth:0,
      discovery_source:"manual identity repair"
    })
    .select("*")
    .single();
  if(iErr) throw iErr;
  good=inserted;
  repairs++;
}

const {data:bad,error:bErr}=await supabase
  .from("artists")
  .select("*")
  .eq("ulan_id",BAD_ULAN)
  .maybeSingle();
if(bErr) throw bErr;

if(bad){
  // Migrate graph relationships from the mistaken engineer identity to the painter.
  const {data:rels,error:rErr}=await supabase
    .from("relationships")
    .select("*")
    .or(`from_artist_id.eq.${bad.id},to_artist_id.eq.${bad.id}`);
  if(rErr) throw rErr;

  for(const r of rels||[]){
    const newFrom=r.from_artist_id===bad.id ? good.id : r.from_artist_id;
    const newTo=r.to_artist_id===bad.id ? good.id : r.to_artist_id;

    if(newFrom===newTo){
      await supabase.from("relationships")
        .update({review_status:"rejected_identity"})
        .eq("id",r.id);
      rejectedRelationships++;
      continue;
    }

    // Avoid creating a duplicate semantic row if the correct painter already has it.
    const {data:dupes,error:dErr}=await supabase
      .from("relationships")
      .select("id")
      .eq("from_artist_id",newFrom)
      .eq("to_artist_id",newTo)
      .eq("relationship_type",r.relationship_type)
      .eq("visual_class",r.visual_class)
      .eq("directed",r.directed)
      .limit(1);
    if(dErr) throw dErr;

    if(dupes?.length){
      const targetId=dupes[0].id;

      // Copy evidence to the already-correct relationship.
      const {data:ev,error:eErr}=await supabase
        .from("relationship_evidence")
        .select("*")
        .eq("relationship_id",r.id);
      if(eErr) throw eErr;

      for(const e of ev||[]){
        const {data:exists,error:xErr}=await supabase
          .from("relationship_evidence")
          .select("id")
          .eq("relationship_id",targetId)
          .eq("source",e.source)
          .eq("source_url",e.source_url)
          .limit(1);
        if(xErr) throw xErr;

        if(!exists?.length){
          const {error:insErr}=await supabase
            .from("relationship_evidence")
            .insert({
              relationship_id:targetId,
              source:e.source,
              source_url:e.source_url,
              evidence_text:e.evidence_text,
              confidence:e.confidence,
              review_status:e.review_status
            });
          if(insErr) throw insErr;
        }
      }

      await supabase.from("relationships")
        .update({review_status:"rejected_identity"})
        .eq("id",r.id);
      rejectedRelationships++;
    }else{
      const {error:uErr}=await supabase
        .from("relationships")
        .update({
          from_artist_id:newFrom,
          to_artist_id:newTo
        })
        .eq("id",r.id);
      if(uErr) throw uErr;
      migratedRelationships++;
    }
  }

  // Preserve the incorrect ULAN record for audit, but exclude it from the graph.
  const {error:badUpdateErr}=await supabase
    .from("artists")
    .update({
      review_status:"rejected_identity",
      default_visible:false,
      discovery_source:"rejected duplicate-name identity"
    })
    .eq("id",bad.id);
  if(badUpdateErr) throw badUpdateErr;

  repairs++;
}

await supabase.from("crawl_runs").update({
  completed_at:new Date().toISOString(),
  status:"completed",
  success_count:repairs,
  notes:`Known Giovanni da Milano collision repaired. relationships migrated=${migratedRelationships}; relationships rejected=${rejectedRelationships}.`
}).eq("id",run.id);

console.log("Identity collision repair complete.");
console.log(`Identity records repaired: ${repairs}`);
console.log(`Relationships migrated to painter: ${migratedRelationships}`);
console.log(`Duplicate/self relationships rejected: ${rejectedRelationships}`);
