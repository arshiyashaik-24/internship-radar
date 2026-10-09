// Minimal robots.txt support (RFC 9309): groups by user-agent, longest-match
// Allow/Disallow with "*" and "$" wildcards.

export function parseRobots(txt) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const rawLine of String(txt ?? '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      lastWasAgent = false;
      if (current) current.rules.push({ allow: key === 'allow', path: value });
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function ruleMatches(rulePath, path) {
  if (rulePath === '') return false;
  const anchored = rulePath.endsWith('$');
  const body = anchored ? rulePath.slice(0, -1) : rulePath;
  const re = new RegExp('^' + body.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
  return re.test(path);
}

export function isAllowed(groups, userAgentToken, pathWithQuery) {
  const ua = userAgentToken.toLowerCase();
  let group = groups.find((g) => g.agents.some((a) => a !== '*' && ua.includes(a)));
  if (!group) group = groups.find((g) => g.agents.includes('*'));
  if (!group) return true;
  let best = null;
  for (const r of group.rules) {
    if (ruleMatches(r.path, pathWithQuery)) {
      const len = r.path.replace(/\$$/, '').length;
      if (!best || len > best.len || (len === best.len && r.allow)) best = { len, allow: r.allow };
    }
  }
  return best ? best.allow : true;
}
