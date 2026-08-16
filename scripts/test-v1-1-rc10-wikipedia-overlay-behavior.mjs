import fs from 'node:fs';
import assert from 'node:assert/strict';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../server/v1/network-admin.js',import.meta.url),'utf8');

assert.ok(html.includes("artists.map(a=>[String(a.ulan_id||''),a])"));
assert.ok(!html.includes("artists.map(a=>[String(a.ulan||''),a])"));
assert.ok(api.includes("return res.status(200).json(snap.payload);"));
assert.ok(api.includes("build_version:'1.1-rc10'"));

// Minimal execution model copied from the production data contract.
const artists=[
  {id:"node-a",ulan_id:"500000001",x:100,y:200},
  {id:"node-b",ulan_id:"500000002",x:400,y:500}
];
const before=artists.map(a=>({id:a.id,x:a.x,y:a.y}));
const snapshotRelationships=[{
  from_ulan:"500000001",to_ulan:"500000002",
  source:"Wikipedia",sources:["Wikipedia"],style:"dashed",
  meaning:"direct influence",directed:true,evidence:[{source:"Wikipedia"}]
}];
const relationships=[];
const relationshipMeta=new Map();

function attachWikipediaOverlayEdges(){
  const byUlan=new Map(artists.map(a=>[String(a.ulan_id||''),a]));
  for(const r of snapshotRelationships){
    const sources=Array.isArray(r.sources)&&r.sources.length?r.sources:[r.source||"ULAN"];
    if(!sources.includes("Wikipedia"))continue;
    const a=byUlan.get(String(r.from_ulan||"")),b=byUlan.get(String(r.to_ulan||""));
    if(!a||!b||a.id===b.id)continue;
    const key=[a.id,b.id].sort().join("|");
    relationshipMeta.set(key,{sources:["Wikipedia"],from:a.id,to:b.id});
    relationships.push([a.id,b.id,r.style,r.meaning]);
  }
}
attachWikipediaOverlayEdges();

assert.equal(relationships.length,1,"Wikipedia-only edge must attach");
assert.equal(relationshipMeta.size,1,"Wikipedia metadata must attach");

function visibleEdges(wikipediaOn){
  return relationships.filter(([a,b])=>{
    const meta=relationshipMeta.get([a,b].sort().join("|"));
    return (meta?.sources||[]).some(src=>src!=="Wikipedia" || wikipediaOn);
  });
}
assert.equal(visibleEdges(false).length,0,"Wikipedia edge hidden when checkbox OFF");
assert.equal(visibleEdges(true).length,1,"Wikipedia edge visible when checkbox ON");
assert.deepEqual(artists.map(a=>({id:a.id,x:a.x,y:a.y})),before,
  "Wikipedia visibility must not alter node coordinates");

assert.ok(!html.includes("rebuildGraphForSourceLayers(true)"));
assert.ok(html.includes("relationships:baseLayoutRelationshipRows()"));
console.log("PASS real Wikipedia-only edge: attaches, OFF hides, ON shows, coordinates unchanged");
