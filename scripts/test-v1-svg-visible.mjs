import fs from 'node:fs';
const v=fs.readFileSync(new URL('../public/v1.html',import.meta.url),'utf8');
const checks=[
 ['canvas css fills viewport',v.includes('#canvas{position:absolute;inset:0;width:100%;height:100%;display:block')],
 ['svg explicit dimensions',v.includes('<svg id="canvas" width="100%" height="100%"')],
 ['empty-render diagnostic',v.includes('No artists pass the current')]
];
let fail=0;for(const [n,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${n}`);if(!ok)fail++}process.exit(fail?1:0);
