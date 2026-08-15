const ROUTES={
  "override":require("../server/handlers/admin-override.js"),
  "media":require("../server/handlers/artist-media.js"),
  "cache-media":require("../server/handlers/cache-artist-media.js"),
  "admit":require("../server/handlers/admit-candidate.js"),
  "relationship-edit":require("../server/handlers/admin-relationship.js"),
  "low-countries-diagnostic":require("../server/handlers/low-countries-diagnostic.js"),
  "trecento-relationship-diagnostic":require("../server/handlers/trecento-relationship-diagnostic.js"),
  "manual-artist-add":require("../server/handlers/manual-artist-add.js"),
  "ulan-role-backfill":require("../server/handlers/ulan-role-backfill.js"),
  "ulan-direction-repair":require("../server/handlers/ulan-direction-repair.js")
};
module.exports=async function handler(req,res){
  const action=String(req.query?.action||"");
  const fn=ROUTES[action];
  if(!fn) return res.status(400).json({error:"Unknown artists action",allowed:Object.keys(ROUTES)});
  return fn(req,res);
};
module.exports._routes=Object.keys(ROUTES);
