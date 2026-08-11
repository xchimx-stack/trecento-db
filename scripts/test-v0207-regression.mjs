import fs from "node:fs";
const html=fs.readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
const checks=[
  ["city filter button", html.includes('id="cityFilterBtn"')],
  ["select all semantics", html.includes("Select all") && html.includes("indeterminate")],
  ["filter hides artists", html.includes("artistPassesCityFilter") && html.includes("artistVisibleInScope")],
  ["counts honor city filter", html.includes("artistIncludedInSelectedTierRaw(a) && artistPassesCityFilter(a)")],
  ["drawer uses visible scope", html.includes("artists.filter(artistVisibleInScope)")],
  ["filter resets viewport", html.includes("function onCityFilterChanged()") && html.includes("overview();")],
  ["network-specific filters", html.includes("cityFilters:{trecento:null,low:null}")]
];
const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log(`${ok?"PASS":"FAIL"} ${name}`);
if(failed.length) process.exit(1);
