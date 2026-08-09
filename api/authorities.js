const ROUTES={
  "ulan":require("../server/handlers/ulan-resolve.js"),
  "zeri":require("../server/handlers/zeri-connections.js")
};
module.exports=async function handler(req,res){
  const action=String(req.query?.action||"");
  const fn=ROUTES[action];
  if(!fn) return res.status(400).json({error:"Unknown authorities action",allowed:Object.keys(ROUTES)});
  return fn(req,res);
};
module.exports._routes=Object.keys(ROUTES);
