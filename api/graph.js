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


    function fallbackLowCountriesGeo(rec){
      const current=String(rec?.geography_bucket||"").trim();
      if(current && !/^unknown$/i.test(current)) return {region:current,source:rec.geography_source||null};
      const checks=[
        [rec?.active_place,"ULAN active location"],
        [rec?.death_place,"ULAN death place fallback"],
        [rec?.birth_place,"ULAN birth place fallback"]
      ];
      const rules=[
        ["Antwerp",/\bantwerp\b|\bantwerpen\b/i],["Brussels",/\bbrussels\b|\bbruxelles\b|\bbrussel\b/i],
        ["Ghent",/\bghent\b|\bgent\b/i],["Bruges",/\bbruges\b|\bbrugge\b/i],["Mechelen",/\bmechelen\b|\bmalines\b/i],
        ["Amsterdam",/\bamsterdam\b/i],["Haarlem",/\bhaarlem\b/i],["Leiden",/\bleiden\b|\bleyden\b/i],
        ["Delft",/\bdelft\b/i],["The Hague",/\bthe hague\b|\bden haag\b|s-gravenhage/i],["Dordrecht",/\bdordrecht\b|\bdort\b/i],
        ["Rotterdam",/\brotterdam\b/i],["Utrecht",/\butrecht\b/i],["Deventer",/\bdeventer\b/i],["Middelburg",/\bmiddelburg\b/i],["Zeeland",/\bzeeland\b/i]
      ];
      for(const [value,source] of checks){
        if(!value) continue;
        for(const [name,rx] of rules) if(rx.test(String(value))) return {region:name,source};
      }
      return {region:"Unknown",source:rec?.geography_source||null};
    }
    const artists = [];
    const seen = new Set();

    for (const s of (seeds || [])) {
      const id=String(s.ulan_id||"");
      if(!/^5\d{8}$/.test(id)||seen.has(id)) continue;
      seen.add(id);
      const geo=fallbackLowCountriesGeo(s);
      artists.push({
        canonical_name:s.preferred_name||s.seed_name,
        seed_name:s.seed_name,
        ulan:{id},
        layout:{year:s.birth_year ? Number(s.birth_year)+35 : (s.death_year ? Number(s.death_year)-45 : null),region:geo.region},
        birth_year:s.birth_year,death_year:s.death_year,birth_place:s.birth_place||null,death_place:s.death_place||null,active_place:s.active_place||null,geography_source:geo.source||null,
        network_tier:"core",crawl_depth:0,review_status:s.status,
        nationality_text:null,role_text:null
      });
    }

    for (const c of (candidates || [])) {
      const id=String(c.ulan_id||"");
      if(!/^5\d{8}$/.test(id)) continue;
      if(seen.has(id)){
        // A ULAN identity can exist in both the curated seed queue and the candidate
        // pool. Keep the seed's Core status, but merge richer ULAN place evidence
        // from the candidate instead of silently discarding it.
        const a=artists.find(x=>String(x.ulan?.id||"")===id);
        if(a){
          a.birth_place=a.birth_place||c.birth_place||null;
          a.death_place=a.death_place||c.death_place||null;
          a.active_place=a.active_place||c.active_place||null;
          a.birth_year=a.birth_year||c.birth_year||null;
          a.death_year=a.death_year||c.death_year||null;
          const merged=fallbackLowCountriesGeo({
            geography_bucket:a.layout?.region,geography_source:a.geography_source,
            active_place:a.active_place,death_place:a.death_place,birth_place:a.birth_place
          });
          a.layout.region=merged.region;a.geography_source=merged.source||a.geography_source||c.geography_source||null;
        }
        continue;
      }
      seen.add(id);
      const geo=fallbackLowCountriesGeo(c);
      artists.push({
        canonical_name:c.preferred_name||c.discovered_label||id,
        seed_name:c.discovered_label||c.preferred_name||id,
        ulan:{id},
        layout:{year:c.birth_year ? Number(c.birth_year)+35 : (c.death_year ? Number(c.death_year)-45 : null),region:geo.region},
        birth_year:c.birth_year,death_year:c.death_year,birth_place:c.birth_place||null,death_place:c.death_place||null,active_place:c.active_place||null,geography_source:geo.source||null,
        network_tier:Number(c.crawl_depth)===2?"tier3":"tier2",
        crawl_depth:Number(c.crawl_depth)||1,review_status:c.review_status,
        nationality_text:c.nationality_text||null,role_text:c.role_text||null
      });
    }

    const valid=new Set(artists.map(a=>String(a.ulan.id)));
    const artistByUlan=new Map(artists.map(a=>[String(a.ulan.id),a]));
    function canonicalLowCountriesDirection(edge){
      // Direction is normalized from Getty ULAN reciprocal terms during ingestion/repair.
      // Do not infer direction from chronology: active/layout dates are approximate and
      // can invert historically documented teacher/pupil relationships.
      return {from:String(edge.from_ulan_id||""),to:String(edge.to_ulan_id||"")};
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

    // Layout-only geographic inheritance for artists whose authority records do
    // not provide a usable place. A documented pupil/workshop relationship means
    // the artist necessarily spent time in the master's working environment.
    // Use only solid training/workshop edges, require a single unambiguous known
    // region among incoming master/parent nodes, and preserve provenance.
    const byUlan=new Map(artists.map(a=>[String(a.ulan?.id||""),a]));
    for(let pass=0;pass<3;pass++){
      let changed=0;
      for(const child of artists){
        if(String(child.layout?.region||"").trim() && !/^unknown$/i.test(String(child.layout.region))) continue;
        const childId=String(child.ulan?.id||"");
        const parentRegions=[];
        for(const r of relationships){
          if(!r.directed || r.style!=="solid" || String(r.to_ulan)!==childId) continue;
          const type=String(r.source_relation||r.meaning||"").toLowerCase();
          if(!/teacher|master|pupil|student|apprentice|workshop/.test(type)) continue;
          const parent=byUlan.get(String(r.from_ulan||""));
          const region=String(parent?.layout?.region||"").trim();
          if(region && !/^unknown$/i.test(region)) parentRegions.push(region);
        }
        const unique=[...new Set(parentRegions)];
        if(unique.length===1){
          child.layout.region=unique[0];
          child.geography_source="workshop / parent-node fallback";
          changed++;
        }
      }
      if(!changed) break;
    }

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
      .select("id,canonical_name,entity_type,ulan_id,birth_year,death_year,floruit_start,floruit_end,layout_year,region,region_confidence,chronology_confidence,visibility_score,default_visible,review_status,crawl_depth,discovered_from_artist_id,discovery_source,manual_tier,manual_region,manual_active_from,manual_active_to,merged_into_artist_id,manual_override_note,ulan_roles")
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

  const sourcePriority = { Manual: 400, ULAN: 300, RKD: 200, Wikipedia: 100 };

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
      manual_override_note: a.manual_override_note || null,
      ulan_roles: a.ulan_roles || null
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
