import { cleanQueueMtd, dailyScore, monthlyPool, scorecard, kpiTiles, MEASURES, SCORECARD_CATEGORIES, GATE_KEYS } from './calc.js';
import { load, save, nextWorkday } from './store.js';

let state = load();
let tab = 'Dashboard';
const TABS = ['Dashboard', 'Roster', 'Daily Clean Queues', 'Weekly Measures', 'Monthly Pool', 'Quarterly Scorecard', 'Print Report'];

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (v) => (v == null ? '—' : (v * 100).toFixed(1).replace(/\.0$/, '') + '%');
const usd = (v) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const badge = (s) => `<span class="badge ${s.replace(/ /g, '-')}">${esc(s)}</span>`;

// Weekly values for % measures are stored as fractions (0.95) but typed as whole percents (95).
const isPct = (m) => m.label.includes('(%)');
const toDisplay = (m, v) => (v == null ? '' : isPct(m) ? +(v * 100).toFixed(2) : v);
const fromInput = (m, raw) => { const n = num(raw); return n == null ? null : isPct(m) ? n / 100 : n; };

function commit() { save(state); render(); }

function input(path, value, type = 'text', extra = '') {
  return `<input type="${type}" data-path="${path}" value="${esc(value ?? '')}" ${extra}>`;
}

function set(path, val) {
  const keys = path.split('.');
  let o = state;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys.at(-1)] = val;
}

const views = {
  Dashboard() {
    const mtd = cleanQueueMtd(state.days);
    const tiles = kpiTiles({ weeks: state.weeks, cleanQueuePct: mtd.pct });
    const pool = poolResult(mtd);
    const sc = scResult();
    return `
      <h2>The six KPI areas — most recent week logged</h2>
      <div class="card"><table><tr><th>Area</th><th>This period</th><th>Standard</th><th>Status</th></tr>
      ${tiles.map((t) => `<tr><td>${esc(t.area)}</td><td>${t.value == null ? '—' : t.area.includes('Response') ? t.value + ' min' : t.area.includes('Follow-up') ? t.value : pct(t.value)}</td><td>${esc(t.standard)}</td><td>${badge(t.status)}</td></tr>`).join('')}
      </table><p class="note">Estimate closure and booking rate share one tile. Clean-queue days logged: ${mtd.daysLogged}.</p></div>
      <h2>Monthly bonus pool — snapshot</h2>
      <div class="card grid">
        ${[['Pool total', usd(state.pool.poolTotal || 0)], ['Clean queues earned (50%)', usd(pool.parts.cleanQueue.earned)], ['Net bookings earned (30%)', usd(pool.parts.netBookings.earned)], ['Revenue goal earned (20%)', usd(pool.parts.revenue.earned)], ['Total pool earned', usd(pool.totalEarned)]]
          .map(([k, v]) => `<div><div class="note">${k}</div><div class="big">${v}</div></div>`).join('')}
      </div>
      <h2>Quarterly leadership scorecard — snapshot</h2>
      <div class="card grid">
        <div><div class="note">Team Lead</div><div class="big">${esc(teamLead()?.name ?? 'None flagged')}</div></div>
        <div><div class="note">Score</div><div class="big">${sc.score} / 100</div></div>
        <div><div class="note">Band</div><div class="big" style="font-size:16px">${esc(sc.band)}</div></div>
        <div><div class="note">Premium this quarter</div><div class="big">${usd(sc.premium)}</div></div>
      </div>`;
  },

  Roster() {
    return `<h2>Roster</h2><p class="note">Names, hours and attendance adjustment drive the pool split. Exactly one person should carry the Team Lead flag.</p>
      <div class="card"><table><tr><th>Name</th><th>Role</th><th>Team Lead</th><th>Eligible hours / month</th><th>Attendance adj. %</th><th></th></tr>
      ${state.roster.map((r, i) => `<tr>
        <td>${input(`roster.${i}.name`, r.name)}</td>
        <td>${input(`roster.${i}.role`, r.role)}</td>
        <td><input type="checkbox" data-lead="${i}" ${r.teamLead ? 'checked' : ''}></td>
        <td>${input(`roster.${i}.hours`, r.hours, 'number', 'min="0" data-num')}</td>
        <td>${input(`roster.${i}.attendancePct`, +(r.attendancePct * 100).toFixed(2), 'number', 'min="0" max="100" data-pctin')}</td>
        <td><button class="ghost" data-del-roster="${i}">Remove</button></td></tr>`).join('')}
      </table><button class="act" id="add-person">Add person</button></div>
      ${state.roster.filter((r) => r.teamLead).length > 1 ? '<div class="warn">More than one Team Lead is flagged; the scorecard uses the first.</div>' : ''}`;
  },

  'Daily Clean Queues'() {
    const mtd = cleanQueueMtd(state.days);
    const cols = ['Booking tab clean', 'Chats & emails clean', 'Automation conversations clean', 'Handoffs clean'];
    const sorted = state.days.map((d, i) => ({ d, i })).sort((a, b) => a.d.date.localeCompare(b.d.date));
    return `<h2>Daily clean queues</h2>
      <p class="note">Scored at the 3:30–4:00 sweep. Pick Met or Not met for each of the four points. A day counts only once all four are recorded; an unfinished day is excluded, not scored as zero.</p>
      <div class="card grid"><div><div class="note">MTD clean-queue %</div><div class="big">${mtd.pct == null ? 'no data yet' : pct(mtd.pct)}</div></div>
        <div><div class="note">Days counted</div><div class="big">${mtd.daysLogged}</div></div></div>
      <div class="card"><table><tr><th>Date</th>${cols.map((c) => `<th>${c}</th>`).join('')}<th>Score</th><th></th></tr>
      ${sorted.map(({ d, i }) => { const s = dailyScore(d); return `<tr><td>${input(`days.${i}.date`, d.date, 'date')}</td>
        ${[0, 1, 2, 3].map((p) => `<td><select data-point="${i}.${p}"><option value="">—</option><option value="1" ${d.points[p] === 1 ? 'selected' : ''}>Met</option><option value="0" ${d.points[p] === 0 ? 'selected' : ''}>Not met</option></select></td>`).join('')}
        <td>${s ? `${s.score}/4 · ${pct(s.pct)}` : '<span class="note">incomplete — excluded</span>'}</td>
        <td><button class="ghost" data-del-day="${i}">Remove</button></td></tr>`; }).join('')}
      </table><button class="act" id="add-day">Add next workday</button></div>`;
  },

  'Weekly Measures'() {
    const sorted = state.weeks.map((w, i) => ({ w, i })).sort((a, b) => a.w.weekEnding.localeCompare(b.w.weekEnding));
    return `<h2>Weekly measures log</h2>
      <p class="note">One row per week. Percent measures are typed as whole percents (95 = 95%). Targets are preset from the Pod Workflow Guide. Estimate conversion has no target yet, so it reads "baseline pending".</p>
      <div class="card"><table>
        <tr><th>Week ending</th>${MEASURES.map((m) => `<th>${esc(m.label)}</th>`).join('')}<th></th></tr>
        <tr><th>Target</th>${MEASURES.map((m) => `<th>${m.dir} ${m.target == null ? '—' : isPct(m) ? m.target * 100 + '%' : m.target}</th>`).join('')}<th></th></tr>
        ${sorted.map(({ w, i }) => `<tr><td>${input(`weeks.${i}.weekEnding`, w.weekEnding, 'date')}</td>
          ${MEASURES.map((m) => `<td>${input(`weeks.${i}.values.${m.key}`, toDisplay(m, w.values[m.key]), 'number', `step="any" data-measure="${m.key}"`)}</td>`).join('')}
          <td><button class="ghost" data-del-week="${i}">Remove</button></td></tr>`).join('')}
      </table><button class="act" id="add-week">Add week</button></div>`;
  },

  'Monthly Pool'(printMode = false) {
    const mtd = cleanQueueMtd(state.days);
    const p = poolResult(mtd);
    const f = state.pool;
    const field = (label, key, type = 'number') => `<div><div class="note">${label}</div>${input(`pool.${key}`, f[key], type, type === 'number' ? 'min="0" step="any" data-num' : '')}</div>`;
    return `<h2>Monthly bonus pool</h2>
      <p class="note">Clean queues (50%) + net job bookings excl. estimate jobs (30%) + company revenue goal (20%). Split by eligible scheduled hours.</p>
      <div class="warn">Assumption pending sign-off by the Operations Manager and Owner: bookings and revenue earn in proportion to attainment, capped at 100% of goal.</div>
      <div class="card grid" ${printMode ? 'hidden' : ''}>${field('Reporting month', 'month', 'text')}${field('Pool total ($)', 'poolTotal')}${field('Net bookings actual ($)', 'bookingsActual')}${field('Net bookings goal ($)', 'bookingsGoal')}${field('Company revenue actual ($)', 'revenueActual')}${field('Company revenue goal ($)', 'revenueGoal')}</div>
      <div class="card"><table><tr><th>Part</th><th>Share</th><th>Attainment</th><th>$ Earned</th></tr>
        ${[['Clean queues', 'cleanQueue'], ['Net job bookings', 'netBookings'], ['Company revenue goal', 'revenue']].map(([l, k]) => `<tr><td>${l}</td><td>${pct(p.parts[k].share)}</td><td>${pct(p.parts[k].attainment)}</td><td>${usd(p.parts[k].earned)}</td></tr>`).join('')}
        <tr><th colspan="3">Total pool earned</th><th>${usd(p.totalEarned)}</th></tr></table></div>
      <div class="card"><table><tr><th>Name</th><th>Role</th><th>Eligible hours</th><th>Share</th><th>Payout</th></tr>
        ${p.payouts.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.role)}</td><td>${r.eligibleHours}</td><td>${pct(r.share)}</td><td>${usd(r.payout)}</td></tr>`).join('')}</table></div>`;
  },

  'Quarterly Scorecard'() {
    const sc = scResult();
    const s = state.scorecard;
    return `<h2>Quarterly leadership scorecard</h2>
      <p class="note">Team Lead: <b>${esc(teamLead()?.name ?? 'none flagged on Roster')}</b>. Scores and gate answers are the Operations Manager's judgment and are never auto-derived.</p>
      <div class="card"><div class="note">Quarter</div>${input('scorecard.quarter', s.quarter)}</div>
      <div class="card"><table><tr><th>Category</th><th>Max</th><th>Points earned</th></tr>
        ${SCORECARD_CATEGORIES.map((c) => `<tr><td>${c.label}</td><td>${c.max}</td><td>${input(`scorecard.scores.${c.key}`, s.scores[c.key], 'number', `min="0" max="${c.max}" data-num`)}</td></tr>`).join('')}
        <tr><th>Total</th><th>100</th><th>${sc.score}</th></tr></table></div>
      <div class="card"><b>Eligibility gate — all three required, regardless of score</b><table>
        ${GATE_KEYS.map((g) => `<tr><td>${g.label}</td><td style="width:120px"><select data-path="scorecard.gate.${g.key}"><option value="">—</option><option value="Y" ${s.gate[g.key] === 'Y' ? 'selected' : ''}>Y</option><option value="N" ${s.gate[g.key] === 'N' ? 'selected' : ''}>N</option></select></td></tr>`).join('')}</table></div>
      <div class="card grid"><div><div class="note">Target premium at full score ($/quarter)</div>${input('scorecard.targetPremium', s.targetPremium, 'number', 'min="0" step="any" data-num')}</div>
        <div><div class="note">Band</div><div class="big" style="font-size:16px">${esc(sc.band)}</div></div>
        <div><div class="note">Premium earned</div><div class="big">${usd(sc.premium)}</div></div></div>`;
  },
};

// Print view: composes the existing views, no new calculations.
views['Print Report'] = function () {
  const stamp = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
  return `<div class="noprint"><h2>Print report</h2>
    <p class="note">One page set with the KPI tiles, pool payouts and Team Lead scorecard. Use Print and choose "Save as PDF" to keep a copy.</p>
    <button class="act" id="do-print">Print / Save as PDF</button></div>
    <div class="print-head"><h1>Customer Operations Pod Report</h1><div class="sub">${esc([state.pool.month, state.scorecard.quarter].filter(Boolean).join(' · '))} — generated ${stamp}</div></div>
    ${views.Dashboard()}
    <div class="pagebreak"></div>
    ${views['Monthly Pool'](true)}
    <div class="pagebreak"></div>
    ${views['Quarterly Scorecard']()}`;
};

const teamLead = () => state.roster.find((r) => r.teamLead);
const poolResult = (mtd) => monthlyPool({ ...state.pool, cleanQueuePct: mtd.pct, roster: state.roster });
const scResult = () => scorecard(state.scorecard);

function render() {
  $('#nav').innerHTML = TABS.map((t) => `<button data-tab="${t}" ${t === tab ? 'aria-current="true"' : ''}>${t}</button>`).join('');
  $('#period').textContent = [state.pool.month, state.scorecard.quarter].filter(Boolean).join(' · ') || 'Set the reporting month on the Monthly Pool tab';
  $('#main').innerHTML = views[tab]();
}

document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.dataset.tab) { tab = t.dataset.tab; render(); return; }
  if (t.id === 'do-print') { window.print(); return; }
  if (t.id === 'add-person') { state.roster.push({ name: 'New person', role: 'REP', teamLead: false, hours: 160, attendancePct: 1 }); commit(); }
  if (t.dataset.delRoster != null) { state.roster.splice(+t.dataset.delRoster, 1); commit(); }
  if (t.id === 'add-day') {
    const last = state.days.map((d) => d.date).sort().at(-1);
    state.days.push({ date: last ? nextWorkday(last) : new Date().toISOString().slice(0, 10), points: [null, null, null, null] }); commit();
  }
  if (t.dataset.delDay != null) { state.days.splice(+t.dataset.delDay, 1); commit(); }
  if (t.id === 'add-week') { state.weeks.push({ weekEnding: new Date().toISOString().slice(0, 10), values: {} }); commit(); }
  if (t.dataset.delWeek != null) { state.weeks.splice(+t.dataset.delWeek, 1); commit(); }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.lead != null) { state.roster.forEach((r, i) => { r.teamLead = i === +t.dataset.lead && t.checked; }); return commit(); }
  if (t.dataset.point) {
    const [i, p] = t.dataset.point.split('.').map(Number);
    state.days[i].points[p] = t.value === '' ? null : Number(t.value);
    return commit();
  }
  if (!t.dataset.path) return;
  let v = t.value;
  if (t.dataset.measure) v = fromInput(MEASURES.find((m) => m.key === t.dataset.measure), v);
  else if (t.dataset.pctin) v = (num(v) ?? 100) / 100;
  else if ('num' in t.dataset) v = num(v);
  set(t.dataset.path, v);
  commit();
});

render();
