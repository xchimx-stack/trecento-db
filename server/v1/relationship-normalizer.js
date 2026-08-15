function normQualifier(s){return String(s||'').trim().toLowerCase().replace(/\s+/g,' ')}
function normalizeByRule(rel,rule){
  if(!rel||!rule)throw new Error('Relationship and rule are required');
  const focus=String(rel.focus_ulan||''),counterpart=String(rel.related_ulan||rel.counterpart_ulan||'');
  if(!/^5\d{8}$/.test(focus)||!/^5\d{8}$/.test(counterpart))throw new Error('Valid focus/counterpart ULAN IDs required');
  let from=focus,to=counterpart;
  if(rule.direction_mode==='counterpart_to'){from=counterpart;to=focus}
  else if(rule.direction_mode==='symmetric'){[from,to]=[focus,counterpart].sort()}
  else if(rule.direction_mode!=='focus_to')throw new Error(`Unknown direction_mode: ${rule.direction_mode}`);
  return {...rel,raw_qualifier:normQualifier(rel.raw_qualifier),normalized_family:rule.normalized_family,canonical_from_ulan:from,canonical_to_ulan:to,directed:Boolean(rule.directed),visual_class:rule.visual_class,expansion_eligible:Boolean(rule.expansion_eligible),render_eligible:Boolean(rule.render_eligible),mapping_status:'mapped'};
}
module.exports={normQualifier,normalizeByRule};
