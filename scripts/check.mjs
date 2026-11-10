// Probes every component in config.json once, then updates
// data/current.json (live status) and data/history.json (daily counts).
// Run every 5 minutes by .github/workflows/status.yml.
import { readJson, writeJson, activeWindow } from './lib.mjs';

const config = await readJson('config.json');
const previous = await readJson('data/current.json', { components: [] });
const history = await readJson('data/history.json', { components: {} });
const now = new Date();
const today = now.toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One HTTP attempt. The reason is kept generic on purpose: this data is
// public, and network errors can contain internal hostnames.
async function attempt(check, url) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(config.timeoutMs ?? 10000),
      headers: { 'user-agent': 'tantilium-status-checker' },
    });
    const body = check.expectBody ? await res.text() : (await res.arrayBuffer(), '');
    const latencyMs = Date.now() - started;
    if (res.status !== (check.expectStatus ?? 200)) return { ok: false, latencyMs, reason: `HTTP ${res.status}` };
    if (check.expectBody && !body.includes(check.expectBody)) return { ok: false, latencyMs, reason: 'Unexpected response' };
    return { ok: true, latencyMs };
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return { ok: false, latencyMs: Date.now() - started, reason: timedOut ? 'Timed out' : 'Connection failed' };
  }
}

// Retry once so a single dropped request doesn't count as an outage.
async function probe(check) {
  const url = check.url ?? process.env[check.urlEnv ?? ''];
  if (!url) {
    console.warn(`skipping check: ${check.urlEnv ? `secret ${check.urlEnv} is not set` : 'no url'}`);
    return null;
  }
  const first = await attempt(check, url);
  if (first.ok) return first;
  await sleep(5000);
  return attempt(check, url);
}

function componentStatus(results, slowMs) {
  const known = results.filter(Boolean);
  if (known.length === 0) return { status: 'unknown' };
  const failed = known.filter((r) => !r.ok);
  const latencyMs = Math.max(...known.map((r) => r.latencyMs));
  if (failed.length === known.length) return { status: 'major_outage', latencyMs, reason: failed[0].reason };
  if (failed.length > 0) return { status: 'partial_outage', latencyMs, reason: failed[0].reason };
  if (latencyMs > slowMs) return { status: 'degraded', latencyMs, reason: 'Slow responses' };
  return { status: 'operational', latencyMs };
}

const BUCKET = { operational: 'ok', degraded: 'degraded', partial_outage: 'down', major_outage: 'down', maintenance: 'maintenance' };

const components = await Promise.all(
  config.components.map(async (c) => {
    const results = await Promise.all(c.checks.map(probe));
    let result = componentStatus(results, c.slowMs ?? config.slowMs ?? 4000);
    const window = activeWindow(config, c.id, now);
    // Failures inside the nightly window are expected and don't count as outages.
    if (window && result.status !== 'operational' && result.status !== 'unknown') {
      result = { ...result, status: 'maintenance', reason: window.name };
    }

    const bucket = BUCKET[result.status];
    if (bucket) {
      const days = (history.components[c.id] ??= {});
      const day = (days[today] ??= { ok: 0, degraded: 0, down: 0, maintenance: 0 });
      day[bucket] += 1;
    }

    const prev = previous.components.find((p) => p.id === c.id);
    const since = prev && prev.status === result.status ? prev.since : now.toISOString();
    console.log(`${c.id.padEnd(12)} ${result.status.padEnd(15)} ${result.latencyMs ?? '-'}ms ${result.reason ?? ''}`);
    return { id: c.id, name: c.name, description: c.description, since, ...result };
  }),
);

// Keep only the last N days of history.
const cutoff = new Date(now.getTime() - (config.historyDays ?? 90) * 86400000).toISOString().slice(0, 10);
for (const days of Object.values(history.components)) {
  for (const d of Object.keys(days)) if (d < cutoff) delete days[d];
}

const statuses = components.map((c) => c.status);
let overall = 'operational';
if (statuses.includes('major_outage')) overall = 'major_outage';
else if (statuses.includes('partial_outage')) overall = 'partial_outage';
else if (statuses.includes('degraded')) overall = 'degraded';
else if (statuses.includes('maintenance')) overall = 'maintenance';

await writeJson('data/current.json', {
  updatedAt: now.toISOString(),
  overall,
  maintenanceWindows: (config.maintenance ?? []).map(({ name, note, startUtc, endUtc, components }) => ({
    name, note, startUtc, endUtc, components,
  })),
  components,
});
await writeJson('data/history.json', history);
