#!/usr/bin/env node
// Refresh each catalog entry's `latestVersion` from its plugin repository's
// newest published release or tag. Run by .github/workflows/refresh-catalog-versions.yml
// on a schedule so the version shown in the launcher's plugin catalog stays
// accurate without every launcher instance fanning out to GitHub itself.
//
// Usage:
//   node scripts/refresh-catalog-versions.mjs          # update catalog.json in place
//   node scripts/refresh-catalog-versions.mjs --check   # report changes, write nothing
//
// GITHUB_TOKEN (optional) is used only to raise the API rate limit; all
// referenced repositories are public so an unauthenticated run also works.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CATALOG_PATH = join(dirname(dirname(fileURLToPath(import.meta.url))), 'catalog.json');
const CHECK_ONLY = process.argv.includes('--check');
const TOKEN = process.env.GITHUB_TOKEN || '';

// Only plain, stable version strings feed the catalog "latest" hint — a bare
// vMAJOR[.MINOR[.PATCH]] tag. Pre-releases (v1.0.0-rc1) and moving refs
// (nightly, latest) are ignored so the badge tracks shipped stable versions.
const STABLE_VERSION = /^v?\d+(?:\.\d+)*$/i;

// Mirror of the launcher's compareVersions (src/server/plugins.js) so the
// value we pick is exactly what the launcher treats as "newer" for its
// update-available badge. Returns 1 if a > b, -1 if a < b, 0 if equal.
function compareVersions(a, b) {
  const clean = (v) => String(v || '').replace(/^v/i, '').split(/[.-]/).map((part) => Number(part) || part);
  const aa = clean(a);
  const bb = clean(b);
  for (let i = 0; i < Math.max(aa.length, bb.length); i += 1) {
    const x = aa[i] ?? 0;
    const y = bb[i] ?? 0;
    if (typeof x === 'number' && typeof y === 'number' && x !== y) return x > y ? 1 : -1;
    const xs = String(x);
    const ys = String(y);
    if (xs !== ys) return xs > ys ? 1 : -1;
  }
  return 0;
}

function parseRepo(url) {
  const match = String(url || '').match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/i, '') };
}

async function githubJson(path) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'home-lab-launcher-plugins-catalog-bot' };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const response = await fetch(`https://api.github.com${path}`, { headers });
  if (!response.ok) throw new Error(`GET ${path} -> HTTP ${response.status}`);
  return response.json();
}

// Newest stable version across published releases and tags, or null when the
// repository has none we can read.
async function latestVersionFor({ owner, repo }) {
  const candidates = new Set();
  const releases = await githubJson(`/repos/${owner}/${repo}/releases?per_page=100`);
  for (const release of releases) {
    if (release.draft || release.prerelease) continue;
    if (release.tag_name) candidates.add(release.tag_name);
  }
  const tags = await githubJson(`/repos/${owner}/${repo}/tags?per_page=100`);
  for (const tag of tags) {
    if (tag.name) candidates.add(tag.name);
  }
  let latest = null;
  for (const candidate of candidates) {
    if (!STABLE_VERSION.test(candidate)) continue;
    if (!latest || compareVersions(candidate, latest) > 0) latest = candidate;
  }
  return latest;
}

async function main() {
  const original = readFileSync(CATALOG_PATH, 'utf8');
  const catalog = JSON.parse(original);
  if (!Array.isArray(catalog.plugins)) throw new Error('catalog.json is missing a plugins array');

  const resolved = [];
  let changes = 0;
  for (const plugin of catalog.plugins) {
    const parsed = parseRepo(plugin.repo);
    if (!parsed) {
      console.warn(`! ${plugin.id}: could not parse repo "${plugin.repo}" — skipping`);
      resolved.push(plugin.latestVersion);
      continue;
    }
    try {
      const latest = await latestVersionFor(parsed);
      if (!latest) {
        console.warn(`! ${plugin.id}: no stable release or tag found — keeping ${plugin.latestVersion}`);
        resolved.push(plugin.latestVersion);
        continue;
      }
      if (latest !== plugin.latestVersion) {
        console.log(`~ ${plugin.id}: ${plugin.latestVersion} -> ${latest}`);
        changes += 1;
      } else {
        console.log(`= ${plugin.id}: ${plugin.latestVersion}`);
      }
      resolved.push(latest);
    } catch (error) {
      console.warn(`! ${plugin.id}: ${error.message} — keeping ${plugin.latestVersion}`);
      resolved.push(plugin.latestVersion);
    }
  }

  if (!changes) {
    console.log('\nCatalog versions are already current.');
    return;
  }

  // Rewrite only the latestVersion values (and updatedAt) via targeted text
  // replacement so the rest of catalog.json — formatting, key order, inline
  // arrays — is left byte-for-byte unchanged and diffs stay minimal.
  let index = 0;
  let updated = original.replace(/("latestVersion":\s*")([^"]*)(")/g, (match, prefix, _old, suffix) => {
    const next = resolved[index++];
    return next ? `${prefix}${next}${suffix}` : match;
  });
  if (index !== catalog.plugins.length) {
    throw new Error(`Expected ${catalog.plugins.length} latestVersion fields but replaced ${index}`);
  }
  const today = new Date().toISOString().slice(0, 10);
  updated = updated.replace(/("updatedAt":\s*")[^"]*(")/, `$1${today}$2`);

  if (CHECK_ONLY) {
    console.log(`\n${changes} version(s) would change (--check: catalog.json not written).`);
    return;
  }
  writeFileSync(CATALOG_PATH, updated);
  console.log(`\nUpdated ${changes} version(s) in catalog.json.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
