// Turns GitHub issues labelled "incident" into data/incidents.json.
//
// The repo is public, so anyone can open an issue or comment. Only text
// written by people with write access is published:
//   - an issue appears only once someone with triage rights adds "incident"
//   - the issue body and comments are shown only if their author can push
import { readJson, writeJson } from './lib.mjs';

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
if (!repo || !token) {
  console.error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  process.exit(1);
}

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
  });
  if (!res.ok) throw new Error(`GitHub ${path}: HTTP ${res.status}`);
  return res.json();
}

const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const permissionCache = new Map();

async function canWrite(user, association) {
  if (TRUSTED_ASSOCIATIONS.has(association)) return true;
  if (!user || user.type === 'Bot') return false;
  if (!permissionCache.has(user.login)) {
    try {
      const p = await gh(`/repos/${repo}/collaborators/${encodeURIComponent(user.login)}/permission`);
      permissionCache.set(user.login, ['admin', 'maintain', 'write'].includes(p.permission));
    } catch {
      permissionCache.set(user.login, false);
    }
  }
  return permissionCache.get(user.login);
}

const config = await readJson('config.json');
const componentIds = new Set(config.components.map((c) => c.id));
const issues = await gh(`/repos/${repo}/issues?labels=incident&state=all&sort=created&direction=desc&per_page=50`);

const incidents = [];
for (const issue of issues) {
  if (issue.pull_request) continue;
  const labels = issue.labels.map((l) => (typeof l === 'string' ? l : l.name));

  let stage = 'investigating';
  if (labels.includes('monitoring')) stage = 'monitoring';
  else if (labels.includes('identified')) stage = 'identified';
  if (issue.state === 'closed') stage = 'resolved';

  const impact = labels.includes('maintenance') ? 'maintenance' : labels.includes('major') ? 'major' : 'minor';
  const components = labels
    .filter((l) => l.startsWith('component:'))
    .map((l) => l.slice('component:'.length))
    .filter((id) => componentIds.has(id));

  const updates = [];
  if (issue.body?.trim() && (await canWrite(issue.user, issue.author_association))) {
    updates.push({ at: issue.created_at, body: issue.body.trim() });
  }
  if (issue.comments > 0) {
    const comments = await gh(`/repos/${repo}/issues/${issue.number}/comments?per_page=100`);
    for (const c of comments) {
      if (c.body?.trim() && (await canWrite(c.user, c.author_association))) {
        updates.push({ at: c.created_at, body: c.body.trim() });
      }
    }
  }
  updates.sort((a, b) => b.at.localeCompare(a.at));

  incidents.push({
    id: issue.number,
    title: issue.title,
    stage,
    impact,
    components,
    startedAt: issue.created_at,
    resolvedAt: issue.state === 'closed' ? issue.closed_at : null,
    updates,
    url: issue.html_url,
  });
}

const previous = await readJson('data/incidents.json', null);
const next = { incidents };
// Avoid a commit when nothing changed.
if (JSON.stringify(previous) !== JSON.stringify(next)) {
  await writeJson('data/incidents.json', next);
  console.log(`wrote ${incidents.length} incident(s)`);
} else {
  console.log('incidents unchanged');
}
