const {extractRoles}=require('../server/handlers/ulan-role-backfill.js')._test;
const sample='Names: Example Nationalities: Italian Roles: artist (preferred) painter illuminator Gender: male Birth and Death Places: Born: Siena';
const got=extractRoles(sample);
if(!/painter/i.test(got)||!/illuminator/i.test(got)||/Gender/i.test(got)){console.error('FAIL',got);process.exit(1)}
console.log('PASS ULAN role parser:',got);
