const { createClient } = require("@supabase/supabase-js");

function safeUrl(value, allowedHosts) {
  if (!value) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:") return null;
    if (!allowedHosts.some(h => u.hostname === h || u.hostname.endsWith("." + h))) {
      return null;
    }
    return u.toString();
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST required" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secret) {
    return res.status(500).json({ error: "Supabase configuration missing" });
  }

  const body = req.body || {};
  const ulan = String(body.ulan || "").trim();
  if (!/^5\d{8}$/.test(ulan)) {
    return res.status(400).json({ error: "Invalid ULAN ID" });
  }

  const wikipedia = safeUrl(body.wikipedia, ["wikipedia.org"]);
  const image = safeUrl(body.image, ["wikimedia.org"]);
  const language = body.language === "it" ? "it" : body.language === "en" ? "en" : null;

  if (!wikipedia || !language) {
    return res.status(400).json({ error: "Validated Wikipedia URL and language required" });
  }

  const supabase = createClient(supabaseUrl, secret, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: artist, error: artistError } = await supabase
    .from("artists")
    .select("id")
    .eq("ulan_id", ulan)
    .maybeSingle();

  if (artistError) return res.status(500).json({ error: artistError.message });
  if (!artist) return res.status(404).json({ error: "Artist not found" });

  const title = decodeURIComponent(new URL(wikipedia).pathname.split("/wiki/")[1] || "").replace(/_/g, " ");

  const rows = [
    {
      artist_id: artist.id,
      source: "Wikipedia",
      external_id: `${language}:${title}`,
      url: wikipedia
    },
    {
      artist_id: artist.id,
      source: "WikipediaLanguage",
      external_id: language,
      url: null
    },
    {
      artist_id: artist.id,
      source: "WikipediaMatchMethod",
      external_id: "client_summary_lookup",
      url: null
    }
  ];

  if (image) {
    rows.push({
      artist_id: artist.id,
      source: "BrowserThumbnail",
      external_id: `${language}:${ulan}`,
      url: image
    });
  }

  const { error: upsertError } = await supabase
    .from("external_ids")
    .upsert(rows, { onConflict: "artist_id,source" });

  if (upsertError) return res.status(500).json({ error: upsertError.message });

  return res.status(200).json({ ok: true });
};
