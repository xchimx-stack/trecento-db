const ROUTES={
  "finite":require("../server/handlers/discover-trecento.js"),
  "data":require("../server/handlers/discovery-data.js"),
  "admit":require("../server/handlers/discovery-admit.js")
};
module.exports=async function handler(req,res){
  const action=String(req.query?.action||"");
  const fn=ROUTES[action];
  if(!fn) return res.status(400).json({error:"Unknown discovery action",allowed:Object.keys(ROUTES)});
  return fn(req,res);
};
module.exports._routes=Object.keys(ROUTES);
