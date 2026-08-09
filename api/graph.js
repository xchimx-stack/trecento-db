const { createClient } = require("@supabase/supabase-js");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");

  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secret) {
    return res.status(500).json({ error: "Supabase environment variables are missing." });
  }

  const supabase = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const [
    { data: artists, error: artistsError },
    { data: relationships, error: relationshipsError },
    { data: evidence, error: evidenceError }
  ] = await Promise.all([
    supabase
      .from("artists")
      .select("id,canonical_name,entity_type,ulan_id,birth_year,death_year,floruit_start,floruit_end,layout_year,region,region_confidence,chronology_confidence,visibility_score,default_visible,review_status,crawl_depth,discovered_from_artist_id,discovery_source")
      .order("layout_year", { ascending: true, nullsFirst: false }),
    supabase
      .from("relationships")
      .select("id,from_artist_id,to_artist_id,relationship_type,visual_class,directed,confidence,review_status"),
    supabase
      .from("relationship_evidence")
      .select("relationship_id,source,source_url,evidence_text,confidence,review_status")
  ]);

  if (artistsError) return res.status(500).json({ error: artistsError.message });
  if (relationshipsError) return res.status(500).json({ error: relationshipsError.message });

  const evidenceRows = evidenceError ? [] : (evidence || []);
  const byId = new Map((artists || []).map(a => [a.id, a]));
  const evByRel = new Map();

  for (const e of evidenceRows) {
    if (!evByRel.has(e.relationship_id)) evByRel.set(e.relationship_id, []);
    evByRel.get(e.relationship_id).push(e);
  }

  const sourcePriority = { ULAN: 300, RKD: 200, Wikipedia: 100 };

  const legacyArtists = (artists || [])
    .filter(a => a.entity_type === "person" || a.entity_type === "anonymous_master")
    .map(a => ({
      seed_name: a.canonical_name,
      canonical_name: a.canonical_name,
      record_type: "Person",
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
      review_status: a.review_status,
      crawl_depth: a.crawl_depth,
      discovery_source: a.discovery_source
    }));

  // The database may contain more than one semantic relationship row for the
  // same artist pair (for example, ULAN plus a Wikipedia candidate classification).
  // The visualization intentionally renders ONE edge per artist pair.
  //
  // Merge all evidence first, then choose the visual relationship deterministically:
  // 1. any ULAN-supported row outranks Wikipedia-only rows
  // 2. stronger relationship class: solid > dashed > dotted
  // 3. accepted > candidate
  const stylePriority={solid:300,dashed:200,dotted:100};
  const reviewPriority={accepted:200,imported_unreviewed:150,candidate:100};

  const visualPairs=new Map();

  for (const r of relationships || []) {
    // Preserve rejected edges in Supabase for audit/history, but do not render them.
    if(String(r.review_status||"").startsWith("rejected")) continue;

    const from = byId.get(r.from_artist_id);
    const to = byId.get(r.to_artist_id);
    if (!from?.ulan_id || !to?.ulan_id) continue;

    const pairIds=[String(from.ulan_id),String(to.ulan_id)].sort();
    const pairKey=pairIds.join("|");

    const relEvidence=evByRel.get(r.id)||[];
    const rowSources=[...new Set(relEvidence.map(e=>e.source).filter(Boolean))];
    const hasUlan=rowSources.includes("ULAN");

    const rowScore=
      (hasUlan?10000:0) +
      (stylePriority[r.visual_class]||0) +
      (reviewPriority[r.review_status]||0);

    if(!visualPairs.has(pairKey)){
      visualPairs.set(pairKey,{
        candidates:[],
        evidence:[],
        sources:new Set()
      });
    }

    const bucket=visualPairs.get(pairKey);
    bucket.candidates.push({
      row:r,
      from,
      to,
      score:rowScore,
      sources:rowSources
    });

    for(const e of relEvidence){
      const evidenceKey=[
        e.source||"",
        e.source_url||"",
        e.evidence_text||""
      ].join("|");
      if(!bucket._evidenceKeys) bucket._evidenceKeys=new Set();
      if(bucket._evidenceKeys.has(evidenceKey)) continue;
      bucket._evidenceKeys.add(evidenceKey);
      bucket.evidence.push(e);
      if(e.source) bucket.sources.add(e.source);
    }
  }

  const legacyRelationships=[];

  for(const bucket of visualPairs.values()){
    bucket.candidates.sort((a,b)=>b.score-a.score);
    const chosen=bucket.candidates[0];
    if(!chosen) continue;

    const r=chosen.row;
    const from=chosen.from;
    const to=chosen.to;
    const sources=[...bucket.sources];

    // Existing pre-evidence rows are ULAN-backed by construction.
    if(!sources.length) sources.push("ULAN");

    const displaySource=sources
      .slice()
      .sort((a,b)=>(sourcePriority[b]||0)-(sourcePriority[a]||0))[0]
      || "ULAN";

    legacyRelationships.push({
      relationship_id:r.id,
      from_ulan:String(from.ulan_id),
      to_ulan:String(to.ulan_id),
      style:r.visual_class||"dotted",
      meaning:
        r.visual_class==="solid" ? "pupil / workshop" :
        r.visual_class==="dashed" ? "collaborator / direct influence" :
        "general influence",
      directed:Boolean(r.directed),
      source_relation:r.relationship_type,
      confidence:r.confidence,
      review_status:r.review_status,
      source:displaySource,
      display_source:displaySource,
      sources,
      evidence:bucket.evidence,
      merged_relationship_rows:bucket.candidates.length
    });
  }

  if (req.query && req.query.status === "1") {
    const sourceCounts = {};
    for (const r of legacyRelationships) {
      for (const s of r.sources.length ? r.sources : [r.display_source]) {
        sourceCounts[s] = (sourceCounts[s] || 0) + 1;
      }
    }
    return res.status(200).json({
      source: "Supabase/Postgres",
      artist_count: legacyArtists.length,
      relationship_count: legacyRelationships.length,
      relationship_source_counts: sourceCounts,
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
