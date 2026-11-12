'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readRequired(root, relativePath, issues) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) {
    issues.push('Missing required SEO file: ' + relativePath);
    return '';
  }
  return fs.readFileSync(file, 'utf8');
}

function getMetaContent(html, name) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  const tag = tags.find(item => new RegExp('\\bname\\s*=\\s*["\']' + name + '["\']', 'i').test(item));
  return tag ? (/\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] || '') : '';
}

function audit(root = path.resolve(__dirname, '..')) {
  const issues = [];
  const warnings = [];
  const html = readRequired(root, 'index.html', issues);
  const robots = readRequired(root, 'robots.txt', issues);
  const sitemap = readRequired(root, 'sitemap.xml', issues);

  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() || '';
  const description = getMetaContent(html, 'description');
  const canonical = /<link\b(?=[^>]*\brel=["']canonical["'])[^>]*\bhref=["']([^"']+)["']/i.exec(html)?.[1] || '';
  const robotsMeta = getMetaContent(html, 'robots');
  const sitemapLocation = /^\s*Sitemap:\s*(\S+)\s*$/im.exec(robots)?.[1] || '';
  const rawLocCount = [...sitemap.matchAll(/<loc\b/gi)].length;
  const sitemapLocations = [...sitemap.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map(match => match[1].trim());

  if (!title) issues.push('index.html has no non-empty title element.');
  else if (title.length > 60) warnings.push('Title is ' + title.length + ' characters; review whether it can be more concise.');

  if (!description) issues.push('index.html has no meta description.');
  else if (description.length > 160) warnings.push('Meta description is ' + description.length + ' characters; review its length.');

  let canonicalUrl = null;
  if (!canonical) issues.push('index.html has no canonical link.');
  else {
    try {
      canonicalUrl = new URL(canonical);
      if (!['https:', 'http:'].includes(canonicalUrl.protocol)) issues.push('Canonical URL must use HTTP or HTTPS.');
      if (canonicalUrl.protocol !== 'https:') warnings.push('Canonical URL does not use HTTPS.');
      if (canonicalUrl.search || canonicalUrl.hash) warnings.push('Canonical URL contains a query string or fragment.');
    } catch {
      issues.push('Canonical link is not an absolute valid URL.');
    }
  }

  if (!robotsMeta) warnings.push('No robots meta tag found; confirm the intended indexing policy.');
  if (!/^\s*User-agent:/im.test(robots)) issues.push('robots.txt has no User-agent directive.');

  if (!sitemapLocation) warnings.push('robots.txt does not declare a Sitemap URL.');
  else {
    try {
      const robotsSitemapUrl = new URL(sitemapLocation);
      if (!['https:', 'http:'].includes(robotsSitemapUrl.protocol)) issues.push('robots.txt Sitemap URL must use HTTP or HTTPS.');
      if (canonicalUrl && robotsSitemapUrl.host !== canonicalUrl.host) warnings.push('robots.txt Sitemap host differs from the canonical host.');
    } catch {
      issues.push('robots.txt contains an invalid Sitemap URL.');
    }
  }

  if (!sitemap.trim()) issues.push('sitemap.xml is empty.');
  if (!/<urlset\b/i.test(sitemap)) issues.push('sitemap.xml has no urlset root element.');
  if (!sitemapLocations.length) warnings.push('sitemap.xml contains no loc entries.');
  if (rawLocCount !== sitemapLocations.length) issues.push('sitemap.xml contains malformed or unclosed loc entries.');

  for (const [index, location] of sitemapLocations.entries()) {
    try {
      const url = new URL(location);
      if (!['https:', 'http:'].includes(url.protocol)) issues.push('Sitemap loc entry ' + (index + 1) + ' must use HTTP or HTTPS.');
      if (canonicalUrl && url.host !== canonicalUrl.host) warnings.push('Sitemap loc entry ' + (index + 1) + ' uses a host different from the canonical URL.');
    } catch {
      issues.push('Sitemap loc entry ' + (index + 1) + ' is not an absolute valid URL.');
    }
  }

  for (const [index, block] of [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].entries()) {
    try { JSON.parse(block[1]); }
    catch { issues.push('Structured data block ' + (index + 1) + ' contains invalid JSON.'); }
  }

  return { issues, warnings, title, canonical, sitemapEntries: sitemapLocations.length };
}

function run() {
  const result = audit();
  console.log('Declarafy SEO technical audit');
  console.log('Title: ' + (result.title || '(missing)'));
  console.log('Canonical: ' + (result.canonical || '(missing)'));
  console.log('Sitemap entries: ' + result.sitemapEntries);
  for (const warning of result.warnings) console.warn('WARNING: ' + warning);
  for (const issue of result.issues) console.error('ERROR: ' + issue);
  if (result.issues.length) process.exitCode = 1;
  else console.log('SEO structural audit passed with ' + result.warnings.length + ' warning(s).');
}

if (require.main === module) run();

module.exports = { audit };
