// Usage: node scripts/competition.mjs 2014-04-21 [lookaheadWeeks]
import { readFileSync } from "node:fs";
import { competitionOn } from "../site/lib/competition.js";

const hot100 = JSON.parse(readFileSync(new URL("../data/charts/hot100.json", import.meta.url)));
const [date, ahead] = process.argv.slice(2);
const r = competitionOn(date, hot100, { lookaheadWeeks: ahead ? Number(ahead) : 12 });

console.log(`Release ${r.date} -> chart week ${r.chart_week}`);
console.log(`#1 that week: ${r.number_one ? `${r.number_one.title} (${r.number_one.artist})` : "n/a"}`);
console.log(`\nIn the top ten:`);
for (const s of r.in_top_ten)
  console.log(`  #${String(s.peak).padEnd(2)} peak ${s.peak_date}  ${s.status.padEnd(9)} ${s.title} - ${s.artist}${s.approximate_run ? " *" : ""}`);
console.log(`\nEntering the top ten in the next weeks (until ${r.lookahead_until}):`);
for (const s of r.arriving_in_top_ten)
  console.log(`  +${String(s.weeks_until_top_ten).padStart(2)}w  #${String(s.peak).padEnd(2)} peak ${s.peak_date}  ${s.title} - ${s.artist}`);
console.log(`\n#1s ahead: ${[...new Set(r.number_ones_ahead.map((w) => w.title))].join(", ")}`);
