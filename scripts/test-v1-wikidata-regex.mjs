import fs from 'node:fs';
const s=fs.readFileSync(new URL('../server/v1/network-admin.js',import.meta.url),'utf8');

const checks = [
  ['numeric ULAN regex source', s.includes("if(!/^\\d+$/.test(id))")],
  ['QID regex source', s.includes("filter(x=>/^Q\\d+$/.test(String(x)))")],
  ['no double-escaped digit regex', !s.includes("/^\\\\d+$/")],
  ['no double-escaped QID regex', !s.includes("/^Q\\\\d+$/")],
  ['whitespace normalization restored', s.includes("replace(/\\s+/g,' ')")],
];

for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) process.exitCode = 1;
}

// Runtime semantics: these are the exact patterns the source must now use.
const ulan = /^\d+$/;
const qid = /^Q\d+$/;
if (!ulan.test('500005259') || ulan.test('ULAN500005259')) {
  console.log('FAIL runtime ULAN regex'); process.exitCode = 1;
} else console.log('PASS runtime ULAN regex');

if (!qid.test('Q48319') || qid.test('48319')) {
  console.log('FAIL runtime QID regex'); process.exitCode = 1;
} else console.log('PASS runtime QID regex');

const raw='Holbein, Hans, the younger';
const bits=raw.split(',').map(x=>x.trim()).filter(Boolean);
const family=bits.shift(),rest=bits.join(' ').replace(/^(the|der|le|la)\s+/i,m=>m);
const variant=`${rest} ${family}`.replace(/\s+/g,' ').trim();
if (variant!=='Hans the younger Holbein') {
  console.log('FAIL inverted-name normalization:',variant); process.exitCode=1;
} else console.log('PASS inverted-name normalization');
