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

  if (String(req.query?.network || "").toLowerCase() === "low_countries") {
    const [
      { data: seeds, error: seedsError },
      { data: candidates, error: candidatesError },
      { data: edges, error: edgesError }
    ] = await Promise.all([
      supabase.from("network_seed_queue")
        .select("seed_name,preferred_name,ulan_id,geography_bucket,geography_source,status,birth_year,death_year,birth_place,death_place,active_place")
        .eq("network_id","low_countries")
        .not("ulan_id","is",null),
      supabase.from("low_countries_candidates")
        .select("ulan_id,preferred_name,discovered_label,crawl_depth,review_status,birth_year,death_year,geography_bucket,geography_source,birth_place,death_place,active_place,nationality_text,role_text"),
      supabase.from("low_countries_network_edges")
        .select("from_ulan_id,to_ulan_id,relationship_type,visual_class,directed,source_depth")
    ]);

    if (seedsError) return res.status(500).json({ error: seedsError.message });
    if (candidatesError) return res.status(500).json({ error: candidatesError.message });
    if (edgesError) return res.status(500).json({ error: edgesError.message });

    const artists = [];
    const seen = new Set();

    for (const s of (seeds || [])) {
      const id=String(s.ulan_id||"");
      if(!/^5\d{8}$/.test(id)||seen.has(id)) continue;
      seen.add(id);
      artists.push({
        canonical_name:s.preferred_name||s.seed_name,
        seed_name:s.seed_name,
        ulan:{id},
        layout:{year:s.birth_year ? Number(s.birth_year)+35 : (s.death_year ? Number(s.death_year)-45 : null),region:s.geography_bucket||"Unknown"},
        birth_year:s.birth_year,death_year:s.death_year,birth_place:s.birth_place||null,death_place:s.death_place||null,active_place:s.active_place||null,geography_source:s.geography_source||null,
        network_tier:"core",crawl_depth:0,review_status:s.status,
        nationality_text:null,role_text:null
      });
    }

    for (const c of (candidates || [])) {
      const id=String(c.ulan_id||"");
      if(!/^5\d{8}$/.test(id)||seen.has(id)) continue;
      seen.add(id);
      artists.push({
        canonical_name:c.preferred_name||c.discovered_label||id,
        seed_name:c.discovered_label||c.preferred_name||id,
        ulan:{id},
        layout:{year:c.birth_year ? Number(c.birth_year)+35 : (c.death_year ? Number(c.death_year)-45 : null),region:c.geography_bucket||"Unknown"},
        birth_year:c.birth_year,death_year:c.death_year,birth_place:c.birth_place||null,death_place:c.death_place||null,active_place:c.active_place||null,geography_source:c.geography_source||null,
        network_tier:Number(c.crawl_depth)===2?"tier3":"tier2",
        crawl_depth:Number(c.crawl_depth)||1,review_status:c.review_status,
        nationality_text:c.nationality_text||null,role_text:c.role_text||null
      });
    }

    const valid=new Set(artists.map(a=>String(a.ulan.id)));
    const artistByUlan=new Map(artists.map(a=>[String(a.ulan.id),a]));
    function canonicalLowCountriesDirection(edge){
      let from=String(edge.from_ulan_id||""),to=String(edge.to_ulan_id||"");
      const type=String(edge.relationship_type||"").toLowerCase();
      if(Boolean(edge.directed) && String(edge.visual_class||"")==="solid" && /student|teacher|apprentice|master|pupil|workshop/.test(type)){
        const a=artistByUlan.get(from),b=artistByUlan.get(to);
        const ay=Number(a?.layout?.year),by=Number(b?.layout?.year);
        if(Number.isFinite(ay)&&Number.isFinite(by)&&ay>by+8){const t=from;from=to;to=t;}
      }
      return {from,to};
    }
    const styleRank={solid:300,dashed:200,dotted:100};
    const pairMap=new Map();
    for(const e of (edges||[])){
      const oriented=canonicalLowCountriesDirection(e);
      const from=oriented.from,to=oriented.to;
      if(!valid.has(from)||!valid.has(to)||from===to)continue;
      const key=[from,to].sort().join("|");
      const candidate={
        from_ulan:from,to_ulan:to,style:e.visual_class||"dotted",
        meaning:e.visual_class==="solid"?"pupil / workshop":e.visual_class==="dashed"?"collaborator / direct influence":"general influence",
        directed:Boolean(e.directed),source_relation:e.relationship_type||null,
        source:"ULAN",display_source:"ULAN",sources:["ULAN"]
      };
      const rank=(styleRank[candidate.style]||0)+(candidate.directed?20:0);
      if(!pairMap.has(key))pairMap.set(key,{chosen:candidate,rank,evidence:[]});
      const bucket=pairMap.get(key);
      bucket.evidence.push({source:"ULAN",source_relation:e.relationship_type||null});
      if(rank>bucket.rank){bucket.chosen=candidate;bucket.rank=rank}
    }
    const relationships=[...pairMap.values()].map(bucket=>({
      ...bucket.chosen,
      evidence:bucket.evidence.filter((e,i,a)=>a.findIndex(x=>x.source_relation===e.source_relation)===i)
    }));

    return res.status(200).json({
      generated_at:new Date().toISOString(),
      source:"Supabase/Postgres · Low Countries",
      network:"low_countries",
      count:artists.length,
      artists,
      relationships
    });
  }

  const [
    { data: artists, error: artistsError },
    { data: relationships, error: relationshipsError },
    { data: evidence, error: evidenceError },
    { data: externalIds, error: externalIdsError }
  ] = await Promise.all([
    supabase
      .from("artists")
      .select("id,canonical_name,entity_type,ulan_id,birth_year,death_year,floruit_start,floruit_end,layout_year,region,region_confidence,chronology_confidence,visibility_score,default_visible,review_status,crawl_depth,discovered_from_artist_id,discovery_source,manual_tier,manual_region,manual_active_from,manual_active_to,merged_into_artist_id,manual_override_note")
      .order("layout_year", { ascending: true, nullsFirst: false }),
    supabase
      .from("relationships")
      .select("id,from_artist_id,to_artist_id,relationship_type,visual_class,directed,confidence,review_status"),
    supabase
      .from("relationship_evidence")
      .select("relationship_id,source,source_url,evidence_text,confidence,review_status"),
    supabase
      .from("external_ids")
      .select("artist_id,source,external_id,url")
  ]);

  if (artistsError) return res.status(500).json({ error: artistsError.message });
  if (relationshipsError) return res.status(500).json({ error: relationshipsError.message });

  const evidenceRows = evidenceError ? [] : (evidence || []);
  const acceptedArtists=(artists||[]).filter(a=>{
    const name=String(a.canonical_name||"").trim();
    const obviousBadEntity=/^(12|13|14)\d{2}$/.test(name) || /^\s*,/.test(String(a.canonical_name||""));
    return !String(a.review_status||"").startsWith("rejected") &&
      !a.merged_into_artist_id && !obviousBadEntity;
  });
  const byId = new Map(acceptedArtists.map(a => [a.id, a]));
  const evByRel = new Map();
  const extByArtist = new Map();

  for (const x of (externalIdsError ? [] : (externalIds || []))) {
    if(!extByArtist.has(x.artist_id)) extByArtist.set(x.artist_id,[]);
    extByArtist.get(x.artist_id).push(x);
  }

  for (const e of evidenceRows) {
    // Rejected evidence remains in Supabase for audit/history but must not
    // contribute a visible source stripe or source-filter match.
    if(String(e.review_status||"").startsWith("rejected")) continue;
    if (!evByRel.has(e.relationship_id)) evByRel.set(e.relationship_id, []);
    evByRel.get(e.relationship_id).push(e);
  }

  const sourcePriority = { ULAN: 300, RKD: 200, Wikipedia: 100 };

  const legacyArtists = acceptedArtists
    .filter(a => a.entity_type === "person" || a.entity_type === "anonymous_master")
    .map(a => {
      const external=extByArtist.get(a.id)||[];
      const wikipedia=external
        .filter(x=>x.source==="Wikipedia" && x.url)
        .sort((x,y)=>{
          const xi=String(x.url||"").includes("it.wikipedia.org")?1:0;
          const yi=String(y.url||"").includes("it.wikipedia.org")?1:0;
          return yi-xi;
        })[0]||null;
      const wikidata=external.find(x=>x.source==="Wikidata" && x.url)||null;
      const zeri=external.find(x=>x.source==="Zeri" && x.url)||null;
      const viaf=external.find(x=>x.source==="VIAF")||null;
      return ({
      id: a.id,
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
      discovery_source: a.discovery_source,
      wikipedia_url: wikipedia?.url || null,
      wikipedia_external_id: wikipedia?.external_id || null,
      wikidata_url: wikidata?.url || null,
      wikidata_id: wikidata?.external_id || null,
      zeri_url: zeri?.url || null,
      viaf_id: viaf?.external_id || null,
      viaf_url: viaf?.url || (viaf?.external_id ? `https://viaf.org/viaf/${viaf.external_id}` : null),
      manual_tier: a.manual_tier || null,
      manual_region: a.manual_region || null,
      manual_active_from: a.manual_active_from || null,
      manual_active_to: a.manual_active_to || null,
      merged_into_artist_id: a.merged_into_artist_id || null,
      manual_override_note: a.manual_override_note || null
    });
    });

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
        r.relationship_type==="proposed identity" ? "proposed identity" :
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
