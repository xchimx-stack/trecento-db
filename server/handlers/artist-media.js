const { createClient } = require("@supabase/supabase-js");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");

  const supabaseUrl = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secret) {
    return res.status(500).json({ error: "Supabase configuration missing" });
  }

  const ulan = String(req.query?.ulan || "").trim();
  if (!/^5\d{8}$/.test(ulan)) {
    return res.status(400).json({ error: "Valid ULAN ID required" });
  }

  const supabase = createClient(supabaseUrl, secret, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: artist, error: artistError } = await supabase
    .from("artists")
    .select("id,canonical_name,ulan_id")
    .eq("ulan_id", ulan)
    .maybeSingle();

  if (artistError) return res.status(500).json({ error: artistError.message });
  if (!artist) return res.status(404).json({ error: "Artist not found" });

  const { data: cached, error: cacheError } = await supabase
    .from("external_ids")
    .select("source,external_id,url")
    .eq("artist_id", artist.id);

  if (cacheError) return res.status(500).json({ error: cacheError.message });

  const bySource = new Map((cached || []).map(row => [row.source, row]));

  return res.status(200).json({
    cached: Boolean(bySource.get("Wikipedia")),
    wikipedia: bySource.get("Wikipedia")?.url || null,
    wikipedia_language: bySource.get("WikipediaLanguage")?.external_id || null,
    wikidata: bySource.get("Wikidata")?.url || null,
    image:
      bySource.get("SupabaseThumbnail")?.url ||
      bySource.get("BrowserThumbnail")?.url ||
      bySource.get("WikimediaImage1")?.url ||
      null,
    match_method: bySource.get("WikipediaMatchMethod")?.external_id || null
  });
};
