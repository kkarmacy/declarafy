'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'index.html');
const robotsPath = path.join(root, 'robots.txt');
const sitemapPath = path.join(root, 'sitemap.xml');
const issues = [];
const warnings = [];

function readRequired(file) {
  if (!fs.existsSync(file)) {
    issues.push(`Missing required SEO file: ${path.relative(root, file)}`);
    return '';
  }
  return fs.readFileSync(file, 'utf8');
}

function metaContent(html, attribute, value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tag = new RegExp(`<meta\\b(?=[^>]*\\b${attribute}=["']${escaped}["'])[^>]*>`, 'i').exec(html)?.[0];
  return tag ? /\bcontent=["']([^"']*)["']/i.exec(tag)?.[1] || '' : '';
}

const html = readRequired(htmlPath);
const robots = readRequired(robotsPath);
const sitemap = readRequired(sitemapPath);

const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() || '';
const description = metaContent(html, 'name', 'description');
const canonical = /<link\b(?=[^>]*\brel=["']canonical["'])[^>]*\bhref=["']([^"']+)["']/i.exec(html)?.[1] || '';
const robotsMeta = metaContent(html, 'name', 'robots');
const sitemapLocation = /^\s*Sitemap:\s*(\S+)\s*$/im.exec(robots)?.[1] || '';
const sitemapLocations = [...sitemap.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map(match => match[1].trim());

if (!title) issues.push('index.html has no non-empty title element.');
else if (title.length > 60) warnings.push(`Title is ${title.length} characters; review whether it can be more concise.`);

if (!description) issues.push('index.html has no meta description.');
else if (description.length > 160) warnings.push(`Meta description is ${description.length} characters; review its length.`);

if (!canonical) issues.push('index.html has no canonical link.');
else {
  try {
    const canonicalUrl = new URL(canonical);
    if (canonicalUrl.protocol !== 'https:') warnings.push('Canonical URL does not use HTTPS.');
    if (canonicalUrl.search || canonicalUrl.hash) warnings.push('Canonical URL contains a query string or fragment.');
    if (sitemapLocations.some(location => {
      try { return new URL(location).host !== canonicalUrl.host; } catch { return false; }
    })) warnings.push('Sitemap URL host differs from the canonical host.');
    if (sitemapLocation) {
      try {
        if (new URL(sitemapLocation).host !== canonicalUrl.host) warnings.push('robots.txt Sitemap host differs from the canonical host.');
      } catch { issues.push('robots.txt contains an invalid Sitemap URL.'); }
    }
  } catch {
    issues.push('Canonical link is not an absolute valid URL.');
  }
}

if (!robotsMeta) warnings.push('No robots meta tag found; confirm the intended indexing policy.');
if (!/^\s*User-agent:/im.test(robots)) issues.push('robots.txt has no User-agent directive.');
if (!sitemapLocation) warnings.push('robots.txt does not declare a Sitemap URL.');
if (!sitemap.trim()) issues.push('sitemap.xml is empty.');
if (!/<urlset\b/i.test(sitemap)) issues.push('sitemap.xml has no urlset root element.');
if (!sitemapLocations.length) warnings.push('sitemap.xml contains no loc entries.');

for (const [index, block] of [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].entries()) {
  try { JSON.parse(block[1]); }
  catch { issues.push(`Structured data block ${index + 1} contains invalid JSON.`); }
}

console.log('Declarafy SEO technical audit');
console.log(`Title: ${title || '(missing)'}`);
console.log(`Canonical: ${canonical || '(missing)'}`);
console.log(`Sitemap entries: ${sitemapLocations.length}`);

for (const warning of warnings) console.warn(`WARNING: ${warning}`);
for (const issue of issues) console.error(`ERROR: ${issue}`);

if (issues.length) process.exitCode = 1;
else console.log(`SEO structural audit passed with ${warnings.length} warning(s).`);
