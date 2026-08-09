
const sample = {
  reportOnly: true,
  total: 2,
  offset: 0,
  limit: 8,
  done: true,
  nextOffset: 2,
  candidates: [
    { name: "Agnolo Gaddi", existing: { id: 1, canonical_name: "Gaddi, Agnolo", ulan_id: "500115303", layout_year: 1380, region: "Florence" } },
    { name: "Barnaba da Modena", existing: null }
  ]
};
if (!Array.isArray(sample.candidates)) throw new Error("candidates must be an array");
for (const c of sample.candidates) {
  if (!c || typeof c.name !== "string") throw new Error("candidate name missing");
  if (c.existing && typeof c.existing !== "object") throw new Error("existing shape invalid");
}
console.log("Discovery API/UI contract sample: PASS");
