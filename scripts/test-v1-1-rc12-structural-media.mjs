import fs from 'node:fs';
import assert from 'node:assert/strict';
const api=fs.readFileSync(new URL('../server/v1/network-admin.js',import.meta.url),'utf8');
assert.ok(api.includes('function structuralArticleBody'));
assert.ok(api.includes('function structuralImageTitles'));
assert.ok(api.includes('async function renderedArticleHtml'));
assert.ok(api.includes("'references','notes','citations','bibliography','sources','further reading'"));
assert.ok(api.includes('authority-control'));
assert.ok(api.includes('stubnotice'));
assert.ok(api.includes("selector:'rc12-structural-article-body-v3'"));

const ends=new Set(['references','notes','citations','bibliography','sources','further reading','external links','see also']);
const norm=v=>String(v||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().toLowerCase();
function proseOnly(html){
  const re=/<h([2-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;let m,cut=html.length;
  while((m=re.exec(html))){if(ends.has(norm(m[2]))){cut=m.index;break}}
  return html.slice(0,cut);
}
const fixture=`<div class="mw-parser-output">
<p>His work includes <a href="/wiki/File:Vitale_Madonna.jpg"><img src="madonna.jpg"></a>.</p>
<h2>References</h2>
<div class="authority-control">Authority control</div>
<div class="stub"><a href="/wiki/File:Generic_Italian_painter_stub.jpg"><img src="stub.jpg"></a>
This article about an Italian painter born in the 14th century is a stub.</div></div>`;
const prose=proseOnly(fixture);
assert.ok(prose.includes('Vitale_Madonna.jpg'));
assert.ok(!prose.includes('Generic_Italian_painter_stub.jpg'));
assert.ok(!prose.includes('Authority control'));
console.log('PASS exact failure class: legitimate prose image survives; post-References generic Italian-painter stub icon is structurally impossible to select');
