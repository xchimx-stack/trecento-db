import fs from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const raw = JSON.parse(await fs.readFile(new URL("../data/imported-artists.json", import.meta.url), "utf8"));
const records = Array.isArray(raw) ? raw : (raw.artists || []);

function saneName(s) {
  s = String(s || "").trim();
  if (!s || s.length > 90) return false;
  return !/\b(probably|believe|documented|same artist|few scholars|plague|was the|was probably)\b/i.test(s);
}
function entityType(r) {
  const t = String(r.record_type || "").toLowerCase();
  if (t && t !== "person") return null;
  return /\bmaster of\b|\bmaestro\b/i.test(r.canonical_name || r.seed_name || "")
    ? "anonymous_master" : "person";
}
function nameOf(r) {
  const n = r.canonical_name || r.seed_name || r.name;
  return saneName(n) ? String(n).trim() : null;
}
function yearOf(r) {
  const vals = [r.layout_year, r.year, r.active_start, r.birth_year, r.floruit_start];
  for (const v of vals) if (Number.isFinite(Number(v))) return Math.round(Number(v));
  return null;
}
function regionOf(r) {
  const v = r.region || r.school || null;
  return v === "Unclassified Italy" ? null : v;
}

const cleaned = records
  .map(r => ({ r, name: nameOf(r), type: entityType(r) }))
  .filter(x => x.name && x.type);

console.log(`Source records: ${records.length}`);
console.log(`Artist records accepted: ${cleaned.length}`);

const artistRows = cleaned.map(({r,name,type}) => ({
  canonical_name: name,
  entity_type: type,
  ulan_id: r.ulan?.id ? String(r.ulan.id) : (r.ulan_id ? String(r.ulan_id) : null),
  birth_year: Number.isFinite(Number(r.birth_year)) ? Number(r.birth_year) : null,
  death_year: Number.isFinite(Number(r.death_year)) ? Number(r.death_year) : null,
  floruit_start: Number.isFinite(Number(r.floruit_start)) ? Number(r.floruit_start) : null,
  floruit_end: Number.isFinite(Number(r.floruit_end)) ? Number(r.floruit_end) : null,
  layout_year: yearOf(r),
  region: regionOf(r),
  region_confidence: r.region ? 0.75 : null,
  chronology_confidence: yearOf(r) ? 0.70 : null,
  visibility_score: 0,
  default_visible: false,
  review_status: "imported_unreviewed"
}));

// Upsert artists with ULAN IDs first.
// Deduplicate by ULAN ID before upsert.
// ULAN expansion can surface the same person through multiple relationship paths.
const withUlanMap = new Map();
for (const row of artistRows.filter(r => r.ulan_id)) {
  const key = String(row.ulan_id);
  const existing = withUlanMap.get(key);
  if (!existing) {
    withUlanMap.set(key, row);
  } else {
    // Prefer the more informative non-null fields while retaining one canonical row.
    withUlanMap.set(key, {
      ...existing,
      ...Object.fromEntries(
        Object.entries(row).filter(([,v]) => v !== null && v !== "" && v !== undefined)
      )
    });
  }
}
const withUlan = [...withUlanMap.values()];

// Deduplicate non-ULAN rows by canonical name.
const withoutUlanMap = new Map();
for (const row of artistRows.filter(r => !r.ulan_id)) {
  const key = row.canonical_name.toLowerCase();
  if (!withoutUlanMap.has(key)) withoutUlanMap.set(key,row);
}
const withoutUlan = [...withoutUlanMap.values()];

console.log(`Unique ULAN artists after dedupe: ${withUlan.length}`);
console.log(`Non-ULAN fallback artists after dedupe: ${withoutUlan.length}`);

for (let i=0; i<withUlan.length; i+=100) {
  const batch = withUlan.slice(i,i+100);
  const { error } = await supabase.from("artists")
    .upsert(batch, { onConflict: "ulan_id" });
  if (error) throw error;
}

// Non-ULAN fallbacks are inserted only if the same canonical name is absent.
for (const row of withoutUlan) {
  const { data: existing, error: findErr } = await supabase.from("artists")
    .select("id").eq("canonical_name", row.canonical_name).limit(1);
  if (findErr) throw findErr;
  if (!existing?.length) {
    const { error } = await supabase.from("artists").insert(row);
    if (error) throw error;
  }
}


// Store ULAN variant names as search aliases when present in imported records.
const pendingAliasRecords=[];
for(const {r,name} of cleaned){
  const aliases=Array.isArray(r.aliases)?r.aliases:[];
  if(!aliases.length) continue;
  pendingAliasRecords.push({r,name,aliases});
}

// Read IDs back.
const { data: dbArtists, error: readErr } = await supabase
  .from("artists").select("id,canonical_name,ulan_id");
if (readErr) throw readErr;

const byUlan = new Map(dbArtists.filter(a=>a.ulan_id).map(a=>[String(a.ulan_id),a]));
const byName = new Map(dbArtists.map(a=>[a.canonical_name.toLowerCase(),a]));

const aliasRows=[];
for(const item of pendingAliasRecords){
  const db=item.r.ulan?.id
    ? byUlan.get(String(item.r.ulan.id))
    : byName.get(item.name.toLowerCase());
  if(!db) continue;

  for(const alias of item.aliases){
    const clean=String(alias||"").trim();
    if(!clean || clean===item.name) continue;
    aliasRows.push({
      artist_id:db.id,
      alias:clean,
      language:null,
      source:"Getty ULAN"
    });
  }
}

if(aliasRows.length){
  // Deduplicate before upsert.
  const uniq=new Map();
  for(const row of aliasRows) uniq.set(`${row.artist_id}|${row.alias}`,row);
  const {error:aliasErr}=await supabase
    .from("artist_aliases")
    .upsert([...uniq.values()],{onConflict:"artist_id,alias"});
  if(aliasErr) throw aliasErr;
}


const externalRows = [];
for (const {r,name} of cleaned) {
  const db = r.ulan?.id ? byUlan.get(String(r.ulan.id)) : byName.get(name.toLowerCase());
  if (!db) continue;
  if (r.ulan?.id) externalRows.push({
    artist_id: db.id, source: "ULAN", external_id: String(r.ulan.id),
    url: r.ulan.page_url || `https://www.getty.edu/vow/ULANFullDisplay?find=&role=&nation=&subjectid=${r.ulan.id}`
  });
}
if (externalRows.length) {
  const externalMap = new Map();
  for (const row of externalRows) {
    externalMap.set(`${row.source}|${row.external_id}`, row);
  }
  const uniqueExternalRows = [...externalMap.values()];
  console.log(`Unique external IDs after dedupe: ${uniqueExternalRows.length}`);
  const { error } = await supabase.from("external_ids")
    .upsert(uniqueExternalRows, { onConflict: "source,external_id" });
  if (error) throw error;
}

// Import graph relationships from the TOP-LEVEL relationship array produced
// by the ULAN importer. These already contain normalized direction and style.
const graphRelationships = Array.isArray(raw.relationships) ? raw.relationships : [];
const relationshipRows = [];
const relationshipEvidence = [];
const seenRelationshipKeys = new Set();
let skippedRelationshipEndpoints = 0;

for (const rel of graphRelationships) {
  const from = rel.from_ulan ? byUlan.get(String(rel.from_ulan)) : null;
  const to = rel.to_ulan ? byUlan.get(String(rel.to_ulan)) : null;

  // If either endpoint did not survive artist/entity cleanup, do not create
  // a dangling relationship.
  if (!from || !to || from.id === to.id) {
    skippedRelationshipEndpoints += 1;
    continue;
  }

  const relationshipType = String(
    rel.source_relation ||
    rel.evidence_class ||
    rel.meaning ||
    "related"
  ).toLowerCase();

  const visualClass = ["solid","dashed","dotted"].includes(rel.style)
    ? rel.style
    : "dotted";

  const key = [
    from.id,
    to.id,
    relationshipType,
    visualClass,
    Boolean(rel.directed)
  ].join("|");

  if (seenRelationshipKeys.has(key)) continue;
  seenRelationshipKeys.add(key);

  relationshipRows.push({
    from_artist_id: from.id,
    to_artist_id: to.id,
    relationship_type: relationshipType,
    visual_class: visualClass,
    directed: Boolean(rel.directed),
    confidence: 0.80,
    review_status: "imported_unreviewed",
    _evidence: Array.isArray(rel.evidence) ? rel.evidence : []
  });
}

console.log(`Top-level graph relationships found: ${graphRelationships.length}`);
console.log(`Relationship rows accepted: ${relationshipRows.length}`);
console.log(`Relationships skipped for missing endpoints: ${skippedRelationshipEndpoints}`);

// Relationships currently have no natural uniqueness constraint in schema v1.
// Seed them only if the table is empty.
const { count: existingRelCount, error: countErr } = await supabase
  .from("relationships").select("*", { count:"exact", head:true });
if (countErr) throw countErr;

if ((existingRelCount || 0) === 0 && relationshipRows.length) {
  // Insert in batches and request generated IDs so evidence can be linked.
  for (let i=0; i<relationshipRows.length; i+=100) {
    const batch = relationshipRows.slice(i,i+100);
    const dbBatch = batch.map(({_evidence, ...row}) => row);

    const { data: inserted, error } = await supabase
      .from("relationships")
      .insert(dbBatch)
      .select("id,from_artist_id,to_artist_id,relationship_type,visual_class,directed");

    if (error) throw error;

    // The returned order for insert/select is expected to match insert order.
    // Store the underlying ULAN evidence separately when present.
    const sourceRows = [];
    for (let j=0; j<(inserted||[]).length; j++) {
      const relationshipId = inserted[j].id;
      const evidence = batch[j]._evidence || [];

      if (evidence.length) {
        for (const ev of evidence) {
          sourceRows.push({
            relationship_id: relationshipId,
            source_name: ev.source || "Getty ULAN",
            source_type: "authority_record",
            source_relation: ev.source_relation || batch[j].relationship_type,
            citation: null,
            url: null,
            notes: ev.evidence_class
              ? `Evidence class: ${ev.evidence_class}`
              : null
          });
        }
      } else {
        sourceRows.push({
          relationship_id: relationshipId,
          source_name: "Getty ULAN",
          source_type: "authority_record",
          source_relation: batch[j].relationship_type,
          citation: null,
          url: null,
          notes: null
        });
      }
    }

    if (sourceRows.length) {
      const { error: sourceError } = await supabase
        .from("relationship_sources")
        .insert(sourceRows);
      if (sourceError) throw sourceError;
    }
  }
} else if ((existingRelCount || 0) > 0) {
  console.log(`Relationship table already contains ${existingRelCount} rows; relationship seed skipped.`);
}

const { count: artistCount } = await supabase
  .from("artists").select("*", { count:"exact", head:true });
const { count: relationshipCount } = await supabase
  .from("relationships").select("*", { count:"exact", head:true });

console.log("Supabase seed complete.");
console.log(`Database artists: ${artistCount ?? "?"}`);
console.log(`Database relationships: ${relationshipCount ?? "?"}`);
console.log("The live website has NOT been switched to Supabase yet.");
