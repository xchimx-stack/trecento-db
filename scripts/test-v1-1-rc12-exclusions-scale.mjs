import fs from 'node:fs';
import assert from 'node:assert/strict';

const api=fs.readFileSync(new URL('../server/v1/network-admin.js',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');
const sql=fs.readFileSync(new URL('../supabase/v1.1-rc12-network-exclusions.sql',import.meta.url),'utf8');

assert.ok(sql.includes('create table if not exists public.v1_network_exclusions'));
assert.ok(sql.includes('primary key (network_id, ulan_id)'));
assert.ok(api.includes("async function exclusionSet"));
assert.ok(api.includes("if(excludedUlans.has(counterpart)){excludedSkipped++;continue;}"));
assert.ok(api.includes("action==='exclude-candidate'"));
assert.ok(api.includes("action==='list-exclusions'"));
assert.ok(api.includes("action==='restore-exclusion'"));
assert.ok(api.includes("action==='remove-member'"));
assert.ok(api.includes("QUERY_CHUNK_SIZE=80"));
assert.ok(api.includes("selectInChunks(artistIds"));
assert.ok(api.includes("selectInChunks(memberUlans"));
assert.ok(admin.includes('class="candidate-remove"'));
assert.ok(admin.includes('class="member-remove"'));
assert.ok(admin.includes('class="member-exclude"'));
assert.ok(admin.includes('Excluded artists / candidates'));
assert.ok(admin.includes('SNAPSHOT BUILD FAILED'));
assert.ok(api.includes("build_version:'1.1-rc12'"));
console.log('PASS exclusions/removal UI, discovery denylist, chunked large-network snapshot reads, and phase diagnostics');
