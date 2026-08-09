
const fs=require("fs"), path=require("path"), vm=require("vm");
const routers=["artists","discovery","wikipedia","authorities"];
function response(){
  return {
    code:null,body:null,headers:{},
    status(n){this.code=n;return this},
    json(x){this.body=x;return this},
    setHeader(k,v){this.headers[k]=v}
  };
}
(async()=>{
  for(const name of routers){
    const file=path.join(__dirname,"..","api",`${name}.js`);
    let src=fs.readFileSync(file,"utf8");
    const requires=[...src.matchAll(/require\("([^"]+)"\)/g)].map(m=>m[1]);
    for(const rel of requires){
      const target=path.resolve(path.dirname(file),rel);
      if(!fs.existsSync(target)) throw new Error(`${name}: missing require target ${rel}`);
    }
    src=src.replace(/require\("([^"]+)"\)/g,'(async function stub(){ throw new Error("handler stub should not run") })');
    const sandbox={module:{exports:{}},exports:{},require,console};
    vm.runInNewContext(src,sandbox,{filename:file});
    const fn=sandbox.module.exports;
    const res=response();
    await fn({query:{action:"__invalid__"},method:"GET",headers:{}},res);
    if(res.code!==400) throw new Error(`${name}: expected 400, got ${res.code}`);
    if(!Array.isArray(res.body?.allowed)||!res.body.allowed.length) throw new Error(`${name}: allowed actions missing`);
    console.log(`PASS ${name}: ${res.body.allowed.join(", ")}`);
  }
})().catch(e=>{console.error(e);process.exit(1)});
