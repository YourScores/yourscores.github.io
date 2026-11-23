// Builds teams.json: every team ESPN lists for the leagues YourScores supports.
// The app's team picker reads this file (ESPN's teams endpoint can't be called from a browser).
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const OUT = 'teams.json';
const LEAGUES = {
  nfl: 'football/nfl', nba: 'basketball/nba', nhl: 'hockey/nhl', mlb: 'baseball/mlb',
  wnba: 'basketball/wnba', mls: 'soccer/usa.1',
  cfb: 'football/college-football', cbb: 'basketball/mens-college-basketball'
};
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const out = {};
for (const [code, path] of Object.entries(LEAGUES)){
  try {
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams?limit=1000`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const teams = (j.sports?.[0]?.leagues?.[0]?.teams || []).map(({ team: t }) =>
      [t.id, t.abbreviation || '', t.displayName || '', t.location || '', t.shortDisplayName || '', t.color || '', t.logos?.[0]?.href || '', t.alternateColor || '']);
    if (teams.length < 10) throw new Error(`only ${teams.length} teams`);
    teams.sort((a, b) => a[2].localeCompare(b[2]));
    out[code] = teams;
  } catch (e){
    console.log(`${code}: ${e.message}, keeping previous list`);
    if (prev[code]) out[code] = prev[code];
  }
}
// columns: id, abbreviation, display name, location, short name, color, logo, alternate color
const json = JSON.stringify(out);
if (json !== JSON.stringify(prev)) writeFileSync(OUT, json + '\n');
console.log(Object.entries(out).map(([k, v]) => `${k} ${v.length}`).join(', '));
