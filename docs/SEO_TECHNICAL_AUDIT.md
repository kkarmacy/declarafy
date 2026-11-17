# SEO technical audit — Declarafy / Tributafy

**Branch:** `feature/seo-audit-tributafy`  
**Scope:** SEO only. No SUNAT, OpenHarness, backend, billing, or production changes.

## Initial findings

Reviewed the default-branch `package.json`, `README.md`, `index.html`, `robots.txt`, `sitemap.xml`, and deployment-structure verification script.

### High-priority issues

1. **Canonical host mismatch**
   - The owner confirmed `https://www.declarafy.com/` as the canonical public host.
   - `index.html` canonical, hreflang, Open Graph, icon, and structured-data URLs now use `https://www.declarafy.com/`.
   - `robots.txt` declares `https://www.declarafy.com/sitemap.xml` and the sitemap lists the same host.
   - The automated audit now treats host mismatches as errors. Hosting-level redirects from non-www and HTTP variants still require verification before release.

2. **Brand/domain ambiguity**
   - The owner explicitly confirmed `www.declarafy.com` as the canonical SEO host. Do not change this decision without further authorization.
   - The relationship with `tributafy.com` remains outside this change; do not redirect or repurpose it without a separate decision.

3. **Sitemap is incomplete**
   - The current sitemap contains only the homepage.
   - It does not expose any eligible public service, pricing, educational, or FAQ URLs.
   - The homepage `lastmod` is hard-coded to `2026-07-04`; it must reflect a real content update, not a manually stale date.

4. **The current root document is application-centric**
   - `index.html` contains the full application shell, login/register flows, and application modules.
   - Its metadata describes a tax/advisory product, but the repository does not yet demonstrate a separate crawlable marketing-content architecture.
   - Public acquisition content should be crawlable without requiring authentication. Private application routes and user-specific content must not be exposed in the sitemap.

5. **Metadata and structured data need validation**
   - Existing title, description, Open Graph/Twitter tags, Organization, and SoftwareApplication JSON-LD are a useful starting point.
   - Validate that structured-data claims (offers, contact details, product features, and brand identity) match the live product and visible page content before expanding them.
   - Remove or revise claims that cannot be substantiated on the public page.

## Implementation plan

### Phase 1 — establish canonical architecture
- Canonical public host confirmed: `https://www.declarafy.com/`.
- Verify HTTP-to-HTTPS and non-www-to-www host redirects at the hosting/DNS layer.
- Keep canonical, Open Graph URL, robots sitemap declaration, sitemap locations, and internal links aligned.
- Keep authentication and private application paths out of indexable content.

### Phase 2 — technical SEO automation
- Add a repeatable link/crawl and metadata audit.
- Add Lighthouse CI for performance, accessibility, best practices, and SEO on the confirmed public URL.
- Validate sitemap XML, canonical consistency, robots accessibility, page titles, descriptions, heading structure, image alt text, and JSON-LD.
- Run checks in GitHub Actions on pull requests; do not deploy automatically as part of this SEO work.

### Phase 3 — search content for Peru
- Build crawlable Spanish pages around real product capabilities and high-intent Peruvian tax queries (for example, IGV, Impuesto a la Renta, RUC, comprobantes electrónicos, and SUNAT compliance).
- Add useful FAQs and supporting educational resources with clear authorship, review dates, and references to official sources where appropriate.
- Avoid thin doorway pages, keyword stuffing, fabricated expertise, and unsupported legal/tax promises.

### Phase 4 — measurement
- Review Google Search Console coverage, sitemap processing, queries, impressions, clicks, and page-level indexing.
- Establish a baseline before setting traffic or ranking targets.

## Safety and release controls

- This branch is isolated from `main`.
- No production files or hosting settings have been changed.
- No secrets, credentials, API integrations, or user data are required for SEO checks.
- Do not merge or deploy until the canonical-domain decision is confirmed and automated checks pass.

## Remaining domain verification

The canonical SEO host is confirmed as `https://www.declarafy.com/`. Before release, verify that HTTP and non-www variants redirect permanently to this host, and separately decide whether `tributafy.com` is retained as a distinct property or redirected. No hosting/DNS changes are included in this pull request.
