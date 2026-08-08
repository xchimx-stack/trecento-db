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

const raw = JSON.parse(await fs.readFile(new URL("../data/ulan-import.json", import.meta.url), "utf8"));
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
const withUlan = artistRows.filter(r => r.ulan_id);
const withoutUlan = artistRows.filter(r => !r.ulan_id);

for (let i=0; i<withUlan.length; i+=100) {
  const { error } = await supabase.from("artists")
    .upsert(withUlan.slice(i,i+100), { onConflict: "ulan_id" });
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

// Read IDs back.
const { data: dbArtists, error: readErr } = await supabase
  .from("artists").select("id,canonical_name,ulan_id");
if (readErr) throw readErr;

const byUlan = new Map(dbArtists.filter(a=>a.ulan_id).map(a=>[String(a.ulan_id),a]));
const byName = new Map(dbArtists.map(a=>[a.canonical_name.toLowerCase(),a]));

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
  const { error } = await supabase.from("external_ids")
    .upsert(externalRows, { onConflict: "source,external_id" });
  if (error) throw error;
}

// Import explicit relationships contained in the ULAN JSON.
// We intentionally do not manufacture new scholarly edges here.
const relRows = [];
const sourceRowsPending = [];
const seen = new Set();

function dbArtistForRecord(r) {
  const n = nameOf(r);
  if (r.ulan?.id && byUlan.has(String(r.ulan.id))) return byUlan.get(String(r.ulan.id));
  return n ? byName.get(n.toLowerCase()) : null;
}
function relatedDb(rel) {
  const rid = rel.related_ulan_id || rel.ulan_id || rel.id;
  if (rid && byUlan.has(String(rid))) return byUlan.get(String(rid));
  const n = rel.related_name || rel.name || rel.label;
  return n ? byName.get(String(n).toLowerCase()) : null;
}
function classify(rel) {
  const t = String(rel.relation || rel.relationship_type || rel.type || "").toLowerCase();
  if (/student|pupil|workshop|teacher|master/.test(t)) return {visual_class:"solid", directed:true};
  if (/influence|collabor/.test(t)) return {visual_class:"dashed", directed:true};
  if (/child|parent/.test(t)) return {visual_class:"dotted", directed:true};
  if (/sibling|brother|sister|family/.test(t)) return {visual_class:"dotted", directed:false};
  return {visual_class:"dotted", directed:false};
}

for (const {r} of cleaned) {
  const from = dbArtistForRecord(r);
  if (!from) continue;
  const rels = r.relationships || r.ulan?.relationships || [];
  for (const rel of rels) {
    const to = relatedDb(rel);
    if (!to || to.id === from.id) continue;
    const c = classify(rel);
    let fromId=from.id, toId=to.id;
    const text=String(rel.relation || rel.relationship_type || rel.type || "").toLowerCase();

    // Normalize known inverse wording into influencer/parent -> influenced/child.
    if (/teacher of|parent of/.test(text)) { fromId=from.id; toId=to.id; }
    else if (/student of|pupil of|child of/.test(text)) { fromId=to.id; toId=from.id; }

    const key=[fromId,toId,text,c.visual_class,c.directed].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    relRows.push({
      from_artist_id: fromId,
      to_artist_id: toId,
      relationship_type: text || "related",
      visual_class: c.visual_class,
      directed: c.directed,
      confidence: 0.75,
      review_status: "imported_unreviewed"
    });
  }
}

// Relationships do not yet have a natural uniqueness constraint, so only insert
// if the database is empty. This makes the first seed safe and avoids duplicates.
const { count: existingRelCount, error: countErr } = await supabase
  .from("relationships").select("*", { count:"exact", head:true });
if (countErr) throw countErr;

if ((existingRelCount || 0) === 0 && relRows.length) {
  const { error } = await supabase.from("relationships").insert(relRows);
  if (error) throw error;
}

const { count: artistCount } = await supabase
  .from("artists").select("*", { count:"exact", head:true });
const { count: relationshipCount } = await supabase
  .from("relationships").select("*", { count:"exact", head:true });

console.log("Supabase seed complete.");
console.log(`Database artists: ${artistCount ?? "?"}`);
console.log(`Database relationships: ${relationshipCount ?? "?"}`);
console.log("The live website has NOT been switched to Supabase yet.");
