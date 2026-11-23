// Builds wrestling.json for YourScores.
// Sources: gophersports.com wrestling schedule (results come from the same page)
//          ncaa.com NWCA Coaches Poll (DI team rankings)
// If a source fails, the previous values in wrestling.json are kept.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const OUT = 'wrestling.json';
const SCHEDULE_URL = 'https://gophersports.com/sports/wrestling/schedule';
const RANK_URL = 'https://www.ncaa.com/rankings/wrestling-men/d1/college-wrestling-rankings-nwca-coaches-poll';
const UA = { 'user-agent': 'Mozilla/5.0 (yourscores; +https://yourscores.github.io/)' };

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};

async function getText(url){
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.text();
}

/* ---------- Gophers schedule from the Nuxt payload ---------- */
async function schedule(){
  const html = await getText(SCHEDULE_URL);
  const m = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('schedule: __NUXT_DATA__ not found');
  const arr = JSON.parse(m[1]);
  const WRAP = new Set(['Reactive','ShallowReactive','Ref','ShallowRef','EmptyRef']);
  const R = (i, depth = 0) => {
    if (typeof i !== 'number' || depth > 8) return i;
    const v = arr[i];
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)){
      if (typeof v[0] === 'string' && WRAP.has(v[0])) return R(v[1], depth);
      if (v[0] === 'Date') return v[1];
      return v.map(x => R(x, depth + 1));
    }
    const o = {}; for (const k in v) o[k] = R(v[k], depth + 1); return o;
  };
  const seen = new Set(), events = [];
  arr.forEach((v, i) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return;
    if (!('game_state' in v && 'at_vs' in v && 'result' in v && 'opponent' in v)) return;
    const e = R(i);
    if (!e?.id || seen.has(e.id) || !e.date) return;
    seen.add(e.id); events.push(e);
  });
  if (!events.length) throw new Error('schedule: no events found');
  events.sort((a, b) => a.date.localeCompare(b.date));

  const out = [];
  for (const e of events){
    const title = e.opponent?.title || e.event_name || 'TBA';
    const isTourney = !!e.tournament || e.location_indicator === 'N' && !e.facility;
    const date = e.date.slice(0, 10);
    // multi-day tournaments are listed once per day; keep the first day
    const last = out[out.length - 1];
    if (isTourney && last && last._title === title) continue;
    const hhmm = e.date.slice(11, 16);
    const time = e.time && hhmm !== '00:00' ? hhmm : null;
    const opp = isTourney ? title : `${e.location_indicator === 'A' || e.at_vs === 'at' ? 'at' : 'vs'} ${title}`;
    const site = e.facility?.title || e.location || '';
    const r = e.result || {};
    let result = '';
    if (['W','L','T'].includes(r.status) && r.team_score !== '' && r.team_score != null)
      result = `${r.status} ${r.team_score}-${r.opponent_score}`;
    else if (r.postscore_info) result = String(r.postscore_info).trim();
    else if (r.status && !['N','O',''].includes(r.status)) result = r.status;
    out.push({ date, time, opp, site, tv: (e.media?.tv || '').replace(/^Big Ten Network$/, 'BTN'), result, _title: title });
  }
  return out.map(({ _title, ...x }) => x);
}

/* ---------- NWCA Coaches Poll from ncaa.com ---------- */
async function rankings(){
  const html = await getText(RANK_URL);
  const strip = s => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#039;|&apos;/g, "'").replace(/\s+/g, ' ').trim();
  const body = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
  if (!body) throw new Error('rankings: table not found');
  const rows = [...body[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(r => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => strip(c[1])));
  const top = rows.filter(c => c.length >= 4).map(c => {
    const rank = /^\d+$/.test(c[0]) ? +c[0] : c[0];
    const name = c[1].replace(/\s*\(\d+\)\s*$/, '');
    return [rank, name, +c[3] || c[3]];
  }).slice(0, 20);
  if (top.length < 10) throw new Error(`rankings: only ${top.length} rows`);
  const thru = (strip(html).match(/Through (?:Games )?([A-Z][A-Za-z.]* \d{1,2}, \d{4})/i) || [])[1] || '';
  return { top, rankUpdated: thru ? `through ${thru.replace(/^([A-Z])([A-Z.]+)/, (m, a, b) => a + b.toLowerCase())}` : '' };
}

const data = {
  rankSource: 'NWCA Coaches Poll (ncaa.com)',
  rankUpdated: prev.rankUpdated || '',
  top: prev.top || [],
  gophers: prev.gophers || [],
  updatedAt: prev.updatedAt || null,
  errors: []
};
try { data.gophers = await schedule(); } catch (e){ data.errors.push(String(e.message || e)); }
try { Object.assign(data, await rankings()); } catch (e){ data.errors.push(String(e.message || e)); }

const strip = d => JSON.stringify({ ...d, updatedAt: null, errors: null });
if (strip(data) !== strip(prev) || JSON.stringify(data.errors) !== JSON.stringify(prev.errors || [])) data.updatedAt = new Date().toISOString();
writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n');
console.log(`schedule: ${data.gophers.length} events, rankings: ${data.top.length} teams, errors: ${data.errors.join(' | ') || 'none'}`);
if (data.errors.length === 2) process.exit(1);
