const ROUTES={
  "crawl-data":require("../server/handlers/wiki-crawl-data.js"),
  "relationship-candidates":require("../server/handlers/wiki-relationship-candidates.js")
};
module.exports=async function handler(req,res){
  const action=String(req.query?.action||"");
  const fn=ROUTES[action];
  if(!fn) return res.status(400).json({error:"Unknown wikipedia action",allowed:Object.keys(ROUTES)});
  return fn(req,res);
};
module.exports._routes=Object.keys(ROUTES);
