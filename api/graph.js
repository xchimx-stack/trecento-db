const { createClient } = require("@supabase/supabase-js");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");

  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secret) {
    return res.status(500).json({
      error: "Supabase environment variables are missing."
    });
  }

  const supabase = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const [
    { data: artists, error: artistsError },
    { data: relationships, error: relationshipsError }
  ] = await Promise.all([
    supabase
      .from("artists")
      .select("id,canonical_name,entity_type,ulan_id,birth_year,death_year,floruit_start,floruit_end,layout_year,region,region_confidence,chronology_confidence,visibility_score,default_visible,review_status")
      .order("layout_year", { ascending: true, nullsFirst: false }),
    supabase
      .from("relationships")
      .select("id,from_artist_id,to_artist_id,relationship_type,visual_class,directed,confidence,review_status")
  ]);

  if (artistsError) {
    console.error("artists query failed", artistsError);
    return res.status(500).json({ error: artistsError.message });
  }
  if (relationshipsError) {
    console.error("relationships query failed", relationshipsError);
    return res.status(500).json({ error: relationshipsError.message });
  }

  const byId = new Map((artists || []).map(a => [a.id, a]));

  const legacyArtists = (artists || [])
    .filter(a => a.entity_type === "person" || a.entity_type === "anonymous_master")
    .map(a => ({
      seed_name: a.canonical_name,
      canonical_name: a.canonical_name,
      record_type: a.entity_type === "anonymous_master" ? "Person" : "Person",
      ulan: {
        id: a.ulan_id || null,
        uri: a.ulan_id ? `http://vocab.getty.edu/ulan/${a.ulan_id}` : null
      },
      layout: {
        year: a.layout_year ?? a.floruit_start ?? a.birth_year ?? null,
        region: a.region || "Unclassified Italy"
      },
      birth_year: a.birth_year,
      death_year: a.death_year,
      floruit_start: a.floruit_start,
      floruit_end: a.floruit_end,
      region_confidence: a.region_confidence,
      chronology_confidence: a.chronology_confidence,
      visibility_score: a.visibility_score,
      default_visible: a.default_visible,
      review_status: a.review_status
    }));

  const legacyRelationships = [];
  for (const r of relationships || []) {
    const from = byId.get(r.from_artist_id);
    const to = byId.get(r.to_artist_id);
    if (!from?.ulan_id || !to?.ulan_id) continue;

    legacyRelationships.push({
      from_ulan: String(from.ulan_id),
      to_ulan: String(to.ulan_id),
      style: r.visual_class || "dotted",
      meaning:
        r.visual_class === "solid" ? "pupil / workshop" :
        r.visual_class === "dashed" ? "collaborator / direct influence" :
        "general influence",
      directed: Boolean(r.directed),
      source_relation: r.relationship_type,
      confidence: r.confidence,
      review_status: r.review_status,
      source: "Supabase"
    });
  }

  if (req.query && req.query.status === "1") {
    
  // Relationship evidence is optional during migration; existing ULAN graph
  // remains usable even if the evidence table has not yet been created.
  let evidenceRows=[];
  try{
    const {data:evidence,error:evidenceError}=await supabase
      .from("relationship_evidence")
      .select("relationship_id,source,source_url,evidence_text,confidence,review_status");
    if(!evidenceError) evidenceRows=evidence||[];
  }catch{}

  const sourcePriority={ULAN:300,RKD:200,Wikipedia:100};
  const evidenceByRelationship=new Map();
  for(const e of evidenceRows){
    if(!evidenceByRelationship.has(e.relationship_id)) evidenceByRelationship.set(e.relationship_id,[]);
    evidenceByRelationship.get(e.relationship_id).push(e);
  }

  for(const r of relationships||[]){
    const ev=evidenceByRelationship.get(r.id)||[];
    r.evidence=ev;
    r.sources=[...new Set(ev.map(x=>x.source).filter(Boolean))];
    r.display_source=r.sources
      .slice()
      .sort((a,b)=>(sourcePriority[b]||0)-(sourcePriority[a]||0))[0]
      || "ULAN";
  }

return res.status(200).json({
      source: "Supabase/Postgres",
      artist_count: legacyArtists.length,
      relationship_count: legacyRelationships.length,
      database_artist_rows: (artists || []).length,
      database_relationship_rows: (relationships || []).length,
      timestamp: new Date().toISOString()
    });
  }

  return res.status(200).json({
    generated_at: new Date().toISOString(),
    source: "Supabase/Postgres",
    count: legacyArtists.length,
    artists: legacyArtists,
    relationships: legacyRelationships
  });
};
