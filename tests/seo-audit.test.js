'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { audit } = require('../scripts/seo-audit');

function fixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'declarafy-seo-'));
  const files = {
    'index.html': '<!doctype html><html><head><title>Declarafy | Asesor tributario</title><meta content="Asesoría tributaria para empresas peruanas." name="description"><meta name="robots" content="index,follow"><link rel="canonical" href="https://tributafy.com/"></head><body></body></html>',
    'robots.txt': 'User-agent: *\nAllow: /\nSitemap: https://tributafy.com/sitemap.xml\n',
    'sitemap.xml': '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://tributafy.com/</loc></url></urlset>'
  };
  for (const [name, value] of Object.entries({ ...files, ...overrides })) {
    fs.writeFileSync(path.join(root, name), value);
  }
  return root;
}

test('passes a valid basic SEO fixture without warnings', t => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = audit(root);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.sitemapEntries, 1);
});

test('reports malformed sitemap loc entries', t => {
  const root = fixture({
    'sitemap.xml': '<urlset><url><loc>https://tributafy.com/</url></urlset>'
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = audit(root);
  assert.ok(result.issues.some(issue => issue.includes('malformed or unclosed loc')));
});

test('reports invalid JSON-LD', t => {
  const root = fixture({
    'index.html': '<title>Declarafy</title><meta name="description" content="Tax help"><link rel="canonical" href="https://tributafy.com/"><script type="application/ld+json">{invalid}</script>'
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = audit(root);
  assert.ok(result.issues.some(issue => issue.includes('invalid JSON')));
});

test('warns when sitemap and canonical hosts differ', t => {
  const root = fixture({
    'sitemap.xml': '<urlset><url><loc>https://declarafy.com/</loc></url></urlset>'
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = audit(root);
  assert.ok(result.warnings.some(warning => warning.includes('different from the canonical URL')));
});
