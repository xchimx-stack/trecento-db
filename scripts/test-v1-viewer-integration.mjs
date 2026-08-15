import fs from 'node:fs';
const viewer=fs.readFileSync(new URL('../public/v1.html',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('../public/admin-v1.html',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../server/v1/network-admin.js',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../supabase/v1.0.3-viewer-methodology.sql',import.meta.url),'utf8');
const checks=[
 ['network cards navigate',viewer.includes('openNetwork(n)')&&viewer.includes('?network=')],
 ['tier controls',viewer.includes('data-tier="core"')&&viewer.includes('data-tier="expanded"')&&viewer.includes('data-tier="comprehensive"')],
 ['city filter',viewer.includes('citiesMenu')&&viewer.includes('citycb')],
 ['role filter',viewer.includes('rolesMenu')&&viewer.includes('roleCats')],
 ['source filters',viewer.includes('data-source="ULAN"')&&viewer.includes('data-source="Manual"')&&viewer.includes('Wikipedia (BETA)')],
 ['drawer',viewer.includes('id="drawer"')&&viewer.includes('selectArtist(a)')],
 ['pan zoom',viewer.includes("addEventListener('wheel'")&&viewer.includes("addEventListener('pointerdown'")],
 ['loading indicator',viewer.includes('id="loading"')&&viewer.includes('showLoading')],
 ['methodology popup',viewer.includes('methodBtn')&&viewer.includes('methodology_text')],
 ['admin methodology editor',admin.includes('id="methodologyText"')&&admin.includes('saveMethodology')],
 ['api methodology writable',api.includes("'methodology_text'")],
 ['profile data in graph',api.includes("v1_ulan_profiles")&&api.includes("roles_raw")&&api.includes("active_places")],
 ['media cache read only',api.includes("v1_media_cache")&&viewer.includes("thumbnail_source_url")],
 ['migration exists',migration.includes('add column if not exists methodology_text text')]
];
let fail=0;for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${name}`);if(!ok)fail++}
process.exit(fail?1:0);
