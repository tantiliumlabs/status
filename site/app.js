(() => {
  'use strict';

  // Data lives in the repo's data/ folder and is updated every 5 minutes.
  // Reading it straight from the repo means data commits never redeploy the page.
  const LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const DATA = LOCAL ? '../data/' : 'https://raw.githubusercontent.com/tantiliumlabs/status/main/data/';
  const DAYS = 90;
  const STALE_MINUTES = 20;

  const LABEL = {
    operational: 'Operational',
    degraded: 'Degraded performance',
    partial_outage: 'Partial outage',
    major_outage: 'Major outage',
    maintenance: 'Under maintenance',
    unknown: 'No data yet',
  };
  const BANNER = {
    operational: 'All systems operational',
    degraded: 'Some services are slow',
    partial_outage: 'Some services are having problems',
    major_outage: 'Major outage',
    maintenance: 'Scheduled maintenance in progress',
    unknown: 'Status unavailable',
  };
  const STAGE = { investigating: 'Investigating', identified: 'Identified', monitoring: 'Monitoring', resolved: 'Resolved' };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
  const dateTimeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const timeFmt = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

  function ago(iso) {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const h = Math.round(mins / 60);
    if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`;
    return `${Math.round(h / 24)} days ago`;
  }

  async function load(name) {
    const res = await fetch(`${DATA}${name}?t=${Math.floor(Date.now() / 60000)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    return res.json();
  }

  function lastDays() {
    const out = [];
    const today = new Date();
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }

  function dayClass(day) {
    if (!day) return 's-none';
    const counted = day.ok + day.degraded + day.down;
    if (day.down > 0) return day.down / Math.max(counted, 1) >= 0.1 ? 's-major' : 's-partial';
    if (day.degraded > 0) return 's-degraded';
    if (day.ok > 0) return 's-ok';
    if (day.maintenance > 0) return 's-maintenance';
    return 's-none';
  }

  function dayTitle(date, day) {
    const label = dateFmt.format(new Date(`${date}T12:00:00Z`));
    if (!day) return `${label}: no data`;
    const counted = day.ok + day.degraded + day.down;
    const parts = [];
    if (counted) parts.push(`${((100 * (day.ok + day.degraded)) / counted).toFixed(2)}% uptime`);
    if (day.down) parts.push(`${day.down * 5} min down`);
    if (day.degraded) parts.push(`${day.degraded * 5} min slow`);
    if (day.maintenance) parts.push(`${day.maintenance * 5} min maintenance`);
    return `${label}: ${parts.join(', ') || 'no data'}`;
  }

  function uptime(days, dates) {
    let up = 0, total = 0;
    for (const d of dates) {
      const day = days?.[d];
      if (!day) continue;
      up += day.ok + day.degraded;
      total += day.ok + day.degraded + day.down;
    }
    return total ? `${((100 * up) / total).toFixed(2)}% uptime` : 'No data yet';
  }

  function renderBanner(current, active) {
    const banner = $('banner');
    const stale = (Date.now() - new Date(current.updatedAt).getTime()) / 60000 > STALE_MINUTES;
    let state = current.overall;
    let title = BANNER[state] ?? BANNER.unknown;
    const major = active.find((i) => i.impact === 'major');
    if (active.length && state === 'operational') state = major ? 'major_outage' : 'partial_outage';
    if (active.length) title = active.length === 1 ? active[0].title : `${active.length} ongoing incidents`;
    banner.className = `banner st-${state}`;
    $('banner-title').textContent = title;
    $('banner-sub').textContent = stale
      ? `Status checks haven't reported since ${dateTimeFmt.format(new Date(current.updatedAt))}. This page may be out of date.`
      : `Last checked ${ago(current.updatedAt)}`;
  }

  // Checks can pass while customers still see a problem (e.g. slow deploys),
  // so an open incident naming a service overrides an "operational" check.
  const IMPACT_STATUS = { major: 'partial_outage', minor: 'degraded', maintenance: 'maintenance' };

  function renderComponents(current, history, active) {
    const dates = lastDays();
    $('components').innerHTML = current.components.map((checked) => {
      const incident = active.find((i) => i.components.includes(checked.id));
      const c = incident && checked.status === 'operational'
        ? { ...checked, status: IMPACT_STATUS[incident.impact] ?? 'degraded' }
        : checked;
      const days = history.components?.[c.id];
      const last30 = dates.slice(-30);
      const bars = dates.map((d) => {
        const t = esc(dayTitle(d, days?.[d]));
        return `<span class="bar ${dayClass(days?.[d])}" title="${t}" aria-label="${t}" tabindex="0"></span>`;
      }).join('');
      return `
        <li class="component st-${esc(c.status)}">
          <div class="component-row">
            <span class="component-name">${esc(c.name)}</span>
            <span class="component-status">${esc(LABEL[c.status] ?? c.status)}</span>
          </div>
          <div class="component-desc small muted">${esc(c.description)}</div>
          <div class="bars" role="img" aria-label="Daily history for ${esc(c.name)}">${bars}</div>
          <div class="bars-foot small muted">
            <span><span class="label-90">90 days ago</span><span class="label-30">30 days ago</span></span>
            <span><span class="label-90">${esc(uptime(days, dates))}</span><span class="label-30">${esc(uptime(days, last30))}</span></span>
            <span>Today</span>
          </div>
        </li>`;
    }).join('');
  }

  function windowTimes(w) {
    const today = new Date().toISOString().slice(0, 10);
    const start = new Date(`${today}T${w.startUtc}:00Z`);
    const end = new Date(`${today}T${w.endUtc}:00Z`);
    return `${timeFmt.format(start)}–${timeFmt.format(end)} your time (${w.startUtc}–${w.endUtc} UTC)`;
  }

  function renderMaintenance(current) {
    const windows = current.maintenanceWindows ?? [];
    const el = $('maintenance');
    if (!windows.length) { el.hidden = true; return; }
    const names = Object.fromEntries(current.components.map((c) => [c.id, c.name]));
    el.hidden = false;
    el.innerHTML = `<h2>Scheduled maintenance</h2>` + windows.map((w) => {
      const affected = w.components.length === current.components.length
        ? 'All services'
        : w.components.map((id) => names[id] ?? id).join(', ');
      return `
        <div class="incident">
          <h3>${esc(w.name)}: every day, ${esc(windowTimes(w))}</h3>
          <p class="incident-meta small muted">${esc(affected)}</p>
          ${w.note ? `<p class="update-body" style="margin-top:6px">${esc(w.note)}</p>` : ''}
        </div>`;
    }).join('');
  }

  function incidentHtml(i, names) {
    const affected = i.components.map((id) => names[id] ?? id).join(', ');
    const when = i.resolvedAt
      ? `${dateTimeFmt.format(new Date(i.startedAt))} to ${dateTimeFmt.format(new Date(i.resolvedAt))}`
      : `Started ${dateTimeFmt.format(new Date(i.startedAt))}`;
    const updates = i.updates.map((u) => `
      <div class="update">
        <div class="small muted">${esc(dateTimeFmt.format(new Date(u.at)))}</div>
        <div class="update-body">${esc(u.body)}</div>
      </div>`).join('');
    return `
      <article class="incident impact-${esc(i.impact)}">
        <h3><a href="${esc(i.url)}">${esc(i.title)}</a></h3>
        <p class="incident-meta small muted">
          <span class="pill">${esc(STAGE[i.stage] ?? i.stage)}</span>
          ${esc(when)}${affected ? ` · ${esc(affected)}` : ''}
        </p>
        ${updates}
      </article>`;
  }

  function renderIncidents(current, incidents) {
    const names = Object.fromEntries(current.components.map((c) => [c.id, c.name]));
    const active = incidents.filter((i) => i.stage !== 'resolved');
    const past = incidents.filter((i) => i.stage === 'resolved').slice(0, 10);

    const activeEl = $('active-incidents');
    activeEl.hidden = active.length === 0;
    activeEl.innerHTML = active.map((i) => `<div class="card active impact-${esc(i.impact)}">${incidentHtml(i, names)}</div>`).join('');

    $('past-incidents').innerHTML = past.length
      ? past.map((i) => incidentHtml(i, names)).join('')
      : `<p class="empty muted">No incidents reported.</p>`;
    return active;
  }

  async function refresh() {
    try {
      const [current, history, incidentsFile] = await Promise.all([
        load('current.json'),
        load('history.json').catch(() => ({ components: {} })),
        load('incidents.json').catch(() => ({ incidents: [] })),
      ]);
      const active = renderIncidents(current, incidentsFile.incidents ?? []);
      renderBanner(current, active);
      renderComponents(current, history, active);
      renderMaintenance(current);
      $('updated').textContent = `Updated ${dateTimeFmt.format(new Date(current.updatedAt))}`;
    } catch (err) {
      console.error(err);
      $('banner').className = 'banner st-unknown';
      $('banner-title').textContent = 'Status unavailable';
      $('banner-sub').textContent = "We couldn't load the latest status. Try again in a minute.";
    }
  }

  refresh();
  setInterval(refresh, 60000);
})();
