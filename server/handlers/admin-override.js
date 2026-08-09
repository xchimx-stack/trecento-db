const { createClient } = require('@supabase/supabase-js');

function client() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase admin environment variables are not configured.');
  return createClient(url, key, { auth: { persistSession: false } });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  try {
    const { artistId, tier, mergeIntoArtistId, region, activeFrom, activeTo, note } = req.body || {};
    if (!artistId) return res.status(400).json({ error: 'artistId required' });
    if (mergeIntoArtistId && mergeIntoArtistId === artistId) return res.status(400).json({ error: 'Cannot merge an artist into itself' });

    const db = client();
    const patch = {
      manual_tier: tier || null,
      manual_region: region || null,
      manual_active_from: activeFrom || null,
      manual_active_to: activeTo || null,
      merged_into_artist_id: mergeIntoArtistId || null,
      manual_override_note: note || null,
      manual_override_updated_at: new Date().toISOString()
    };
    const { error } = await db.from('artists').update(patch).eq('id', artistId);
    if (error) throw error;
    return res.status(200).json({ ok: true, artistId, patch });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
};
