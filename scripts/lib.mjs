import { readFile, writeFile } from 'node:fs/promises';

const ROOT = new URL('..', import.meta.url);

export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(new URL(path, ROOT), 'utf8'));
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw err;
  }
}

export function writeJson(path, value) {
  return writeFile(new URL(path, ROOT), JSON.stringify(value, null, 2) + '\n');
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Returns the maintenance window covering this component at this time, or null.
// Windows are daily and may cross midnight (e.g. 23:00 to 02:30).
export function activeWindow(config, componentId, at) {
  const now = at.getUTCHours() * 60 + at.getUTCMinutes();
  for (const w of config.maintenance ?? []) {
    if (!w.components.includes(componentId)) continue;
    const start = toMinutes(w.startUtc);
    const end = toMinutes(w.endUtc);
    const inside = start <= end ? now >= start && now < end : now >= start || now < end;
    if (inside) return w;
  }
  return null;
}
