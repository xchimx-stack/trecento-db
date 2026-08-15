const fs=require('fs');
const html=fs.readFileSync('public/admin-v1.html','utf8');
const server=fs.readFileSync('server/v1/network-admin.js','utf8');
let fail=0;
function check(name,ok){console.log((ok?'PASS ':'FAIL ')+name);if(!ok)fail++}
check('v1 request helper sends auth on GET and POST', html.includes("const t=token();") && html.includes("opt.headers['x-crawl-token']=t") && !html.includes("if(auth||!['GET','HEAD'].includes(method))"));
check('Show current Core uses centralized helper', html.includes("api('frontier',{query:{network:selectedNetwork.id,depth}})"));
check('Core expansion uses centralized helper for frontier', html.includes("const f=await api('frontier',{query:{network:selectedNetwork.id,depth}})"));
check('frontier remains protected server-side', !/publicActions=new Set\([^\n]*frontier/.test(server));
check('verify-token uses same server token validator', server.includes("if(action==='verify-token')") && server.includes('const ok=authorized(req)'));
process.exit(fail?1:0);
