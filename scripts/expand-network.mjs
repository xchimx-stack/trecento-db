/*
Trecento controlled expansion policy — v0.12.0

This is deliberately conservative. It establishes the acceptance/source rules
for the next crawler pass rather than performing an unbounded crawl during
Vercel deployment.

Rules:
- current accepted artists are depth 0 seeds unless already annotated
- first production expansion target: 300 accepted artists maximum
- ULAN Person records only
- one relationship hop in the first pass
- ULAN evidence outranks all secondary evidence
- Wikipedia can add an edge only when ULAN is silent
- Wikipedia cannot delete, reverse, relabel, or override a ULAN edge
- mere co-mention/linking is never a relationship
- Wikipedia relationship extraction requires explicit relationship language
- Wikipedia-only edges enter as review_status='candidate'
- media enrichment is lazy and independent of graph expansion
*/

export const EXPANSION_TARGET=300;
export const MAX_INITIAL_CRAWL_DEPTH=1;

export const SOURCE_PRIORITY={
  ULAN:300,
  RKD:200,        // reserved now so the schema ports cleanly to Dutch network
  Wikipedia:100
};

export const WIKIPEDIA_RELATIONSHIP_PATTERNS=[
  /\bcollaborat(?:ed|ion|ing)\b/i,
  /\bworked (?:with|alongside)\b/i,
  /\bpupil of\b/i,
  /\bstudent of\b/i,
  /\bteacher of\b/i,
  /\bmaster of\b/i,
  /\bworkshop of\b/i,
  /\binfluenc(?:ed by|ed|e)\b/i,
  /\bfather of\b/i,
  /\bson of\b/i,
  /\bbrother of\b/i
];

export function wikipediaSentenceCanProposeEdge(text){
  return WIKIPEDIA_RELATIONSHIP_PATTERNS.some(re=>re.test(String(text||"")));
}

export function mayPublishWikipediaEdge({ulanRelationshipExists=false}={}){
  // Secondary evidence fills silence only. It never overrides ULAN.
  return !ulanRelationshipExists;
}
