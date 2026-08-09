const { createClient } = require('@supabase/supabase-js');

function client() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase admin environment variables are not configured.');
  return createClient(url, key, { auth: { persistSession: false } });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  if (!process.env.WIKI_CRAWL_TOKEN || String(req.headers['x-crawl-token']||'') !== process.env.WIKI_CRAWL_TOKEN) return res.status(401).json({error:'Invalid admin token'});
  try {
    const { artistId, tier, mergeIntoArtistId, region, activeFrom, activeTo, note } = req.body || {};
    if (!artistId) return res.status(400).json({ error: 'artistId required' });
    if (mergeIntoArtistId && mergeIntoArtistId === artistId) return res.status(400).json({ error: 'Cannot merge an artist into itself' });

    const db = client();
    const {data:before,error:beforeErr}=await db.from('artists').select('*').eq('id',artistId).maybeSingle();
    if(beforeErr) throw beforeErr;
    if(!before) return res.status(404).json({error:'Existing artist not found'});
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
    await db.from('admin_change_log').insert({artist_id:artistId,action:'artist_override',previous_value:before,new_value:patch,note:note||null});
    return res.status(200).json({ ok: true, artistId, patch });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
};
