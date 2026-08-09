module.exports=async function handler(req,res){
  const name=String(req.query?.name||"").trim();
  if(!name) return res.status(400).json({error:"name required"});
  const q=encodeURIComponent(name);
  const urls=[
    `https://catalogo.fondazionezeri.unibo.it/ricerca.v2.jsp?fulltext=${q}`,
    `https://fondazionezeri.unibo.it/it/ricerca?query=${q}`
  ];
  for(const url of urls){
    try{
      const r=await fetch(url,{headers:{"User-Agent":"TrecentoNetwork/0.14.2 Zeri resolver"},redirect:"follow"});
      if(!r.ok) continue;
      const text=(await r.text()).toLowerCase();
      const tokens=name.toLowerCase().replace(/[^a-zà-ÿ0-9 ]/g," ").split(/\s+/).filter(x=>x.length>3);
      const hits=tokens.filter(x=>text.includes(x)).length;
      if(tokens.length && hits>=Math.min(2,tokens.length)){
        return res.status(200).json({matched:true,url:r.url||url});
      }
    }catch{}
  }
  res.status(200).json({matched:false,url:null});
};