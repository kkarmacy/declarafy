'use strict';

const { test, expect } = require('@playwright/test');
const { mockAuthenticatedApi } = require('./helpers');

test.beforeEach(async ({ page }) => {
  // The CI browser runner has no guaranteed outbound access to third-party CDNs.
  // Keep UI E2E deterministic without changing production HTML or its dependencies.
  await page.route('https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.6/purify.min.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript; charset=utf-8',
    body: 'window.DOMPurify = window.DOMPurify || { sanitize: value => String(value ?? "") };',
  }));
});

  // Third-party PDF libraries are not required by navigation or visual smoke tests.
  const cdnStubs = [
    ['https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js', 'window.html2pdf = window.html2pdf || (() => ({ from: () => ({ save: () => Promise.resolve() }) }));'],
    ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'window.pdfjsLib = window.pdfjsLib || { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.reject(new Error("PDF.js stub: no document loaded")) }) };'],
    ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js', '/* PDF worker intentionally stubbed in UI E2E. */'],
  ];
  for (const [url, body] of cdnStubs) {
    await page.route(url, route => route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body,
    }));
  }

test.beforeEach(async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#screen-panel')).toBeVisible({ timeout: 15_000 });
});

test('todos los botones de navegación apuntan a módulos existentes', async ({ page }) => {
  const missing = await page.evaluate(() => Array.from(document.querySelectorAll('.pnav .pntab'))
    .map(button => {
      const match = (button.getAttribute('onclick') || '').match(/setPTab\('([^']+)'/);
      if (!match) return null;
      const tab = match[1];
      return document.getElementById(_ptSectionId(tab)) ? null : `${button.textContent.trim()} (${tab})`;
    })
    .filter(Boolean));

  expect(missing, `Módulos sin contenido: ${missing.join(', ')}`).toEqual([]);
});

test('todos los módulos visibles abren contenido utilizable sin errores de JavaScript', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  const problems = await page.evaluate(() => Array.from(document.querySelectorAll('.pnav .pntab'))
    .filter(button => getComputedStyle(button).display !== 'none' && !button.hidden)
    .map(button => {
      const match = (button.getAttribute('onclick') || '').match(/setPTab\('([^']+)'/);
      if (!match) return null;
      const tab = match[1];
      try {
        setPTab(tab, button);
        const section = document.getElementById(_ptSectionId(tab));
        const contentLength = section?.textContent.replace(/\s+/g, ' ').trim().length || 0;
        return section && getComputedStyle(section).display !== 'none' && contentLength >= 30
          ? null
          : { tab, label: button.textContent.trim(), contentLength };
      } catch (error) {
        return { tab, label: button.textContent.trim(), error: error.message };
      }
    })
    .filter(Boolean));

  expect(problems, JSON.stringify(problems, null, 2)).toEqual([]);
  expect(errors).toEqual([]);
});

test('la navegación agrupa los módulos por área y los ordena alfabéticamente', async ({ page }) => {
  const result = await page.evaluate(() => {
    const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
    const clean = value => value.normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/^[^A-Za-z0-9]+/, '')
      .trim();
    const groups = Array.from(document.querySelectorAll('.pnav-group')).map(group => {
      const labels = Array.from(group.querySelectorAll('.pntab')).map(button => clean(button.textContent));
      return {
        title: group.querySelector('.pnav-group-toggle')?.textContent.replace('⌄', '').trim(),
        labels,
        sorted: [...labels].sort(collator.compare),
        ids: Array.from(group.querySelectorAll('.pntab')).map(button =>
          (button.getAttribute('onclick') || '').match(/setPTab\('([^']+)'/)?.[1]).filter(Boolean)
      };
    });
    const allIds = groups.flatMap(group => group.ids);
    return { groups, allIds, uniqueIds: new Set(allIds).size };
  });

  expect(result.groups.length).toBeGreaterThanOrEqual(7);
  expect(result.groups.every(group => group.labels.length > 0)).toBe(true);
  expect(result.groups.every(group => JSON.stringify(group.labels) === JSON.stringify(group.sorted))).toBe(true);
  expect(result.uniqueIds).toBe(result.allIds.length);
  expect(result.groups.map(group => group.title)).toContain('SUNAT y Tributación');
  expect(result.groups.map(group => group.title)).toContain('Finanzas y Contabilidad');
  expect(result.groups.map(group => group.title)).toContain('Documentos y Gestión');
});

test('los 17 módulos especializados abren contenido real', async ({ page }) => {
  // Este recorrido abre los 17 módulos de forma secuencial y puede superar el límite global de 45 s.
  test.setTimeout(120_000);
  await page.locator('.pntab-featured').click();
  const cards = page.locator('#specializedModuleGrid .specialized-card');
  await expect(cards).toHaveCount(17);

  const problems = [];
  for (let index = 0; index < await cards.count(); index += 1) {
    const card = cards.nth(index);
    const label = (await card.locator('strong').textContent() || '').trim();
    const tab = await card.getAttribute('onclick').then(value => value?.match(/openSpecializedModule\('([^']+)'/)?.[1]);
    await card.click();
    const state = await page.evaluate(currentTab => {
      const section = document.getElementById(_ptSectionId(currentTab));
      return {
        exists: Boolean(section),
        visible: Boolean(section && getComputedStyle(section).display !== 'none'),
        contentLength: section?.textContent.trim().length || 0,
      };
    }, tab);
    if (!state.exists || !state.visible || state.contentLength < 30) problems.push({ label, tab, ...state });
    await page.evaluate(() => setPTab('especializados', null));
  }

  expect(problems, JSON.stringify(problems, null, 2)).toEqual([]);
});

test('historial y referidos muestran sus nuevos estados visuales', async ({ page }) => {
  await page.evaluate(() => setPTab('historial', null));
  await expect(page.getByRole('heading', { name: 'Historial de conversaciones' })).toBeVisible();
  await expect(page.locator('.module-empty-state')).toContainText('Aún no tienes conversaciones');

  await page.evaluate(() => setPTab('referidos', null));
  await expect(page.getByRole('heading', { name: 'Invita, comparte y gana' })).toBeVisible();
  await expect(page.locator('.ref-share-card')).toBeVisible();
  await expect(page.locator('#refLink')).toContainText('REFE2ETEST');
});


test('clic real en cada módulo deja exactamente un panel visible y con contenido', async ({ page }) => {
  const buttons = page.locator('.pnav .pntab').filter({ visible: true });
  const count = await buttons.count();
  const problems = [];
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    const onclick = await button.getAttribute('onclick') || '';
    const tab = onclick.match(/setPTab\('([^']+)'/)?.[1];
    if (!tab || tab === 'inicio' || tab === 'especializados') continue;
    await button.click();
    const state = await page.evaluate(currentTab => {
      const id = typeof _ptSectionId === 'function' ? _ptSectionId(currentTab) : '';
      const target = id ? document.getElementById(id) : null;
      const visiblePanels = Array.from(new Set(PT_TAB_NAMES.concat(['terminos', 'privacidad']).map(name => document.getElementById(_ptSectionId(name))).filter(Boolean))).filter(section => {
        const style = getComputedStyle(section);
        return style.display !== 'none' && style.visibility !== 'hidden' && section.getClientRects().length > 0;
      });
      return {
        id,
        targetVisible: Boolean(target && getComputedStyle(target).display !== 'none' && target.getClientRects().length > 0),
        contentLength: target?.innerText.replace(/\s+/g, ' ').trim().length || 0,
        visiblePanelIds: visiblePanels.map(section => section.id),
        blockers: target ? (() => {
          const nodes = [];
          for (let el = target; el; el = el.parentElement) {
            const css = getComputedStyle(el);
            if (el.hidden || css.display === 'none' || css.visibility === 'hidden' || el.getClientRects().length === 0) {
              nodes.push({ tag: el.tagName, id: el.id, className: String(el.className).slice(0, 120), hidden: el.hidden, inlineStyle: el.getAttribute('style'), display: css.display, visibility: css.visibility, rects: el.getClientRects().length });
            }
          }
          return nodes;
        })() : [],
      };
    }, tab);
    if (!state.targetVisible || state.contentLength < 30 || state.visiblePanelIds.length !== 1) problems.push({ tab, ...state });
  }
  expect(problems, JSON.stringify(problems, null, 2)).toEqual([]);
});

test('evidencia visual del dashboard y módulos principales', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const capture = async name => testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
  await capture('dashboard-desktop');

  for (const tab of ['simulador','calculadora','generador','perfil','historial','sunat_api']) {
    await page.evaluate(currentTab => setPTab(currentTab, null), tab);
    await capture('modulo-' + tab);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => setPTab('inicio', null));
  await capture('dashboard-mobile');
});

test('la búsqueda expande categorías y la navegación mantiene un encabezado compacto', async ({ page }) => {
  const search = page.locator('#panelModuleSearch');
  const searchBox = await page.locator('.pnav-search').boundingBox();
  expect(searchBox?.height || 999).toBeLessThan(60);
  await expect(page.locator('.module-location')).toBeHidden();

  const taxGroup = page.locator('.pnav-group[data-category="tax"]');
  await expect(taxGroup).toBeVisible();
  await taxGroup.locator('.pnav-group-toggle').click();
  await expect(taxGroup.locator('.pnav-group-items')).toBeHidden();

  await search.fill('Consultar SUNAT');
  await expect(taxGroup).toBeVisible();
  await expect(taxGroup.locator('.pnav-group-items')).toBeVisible();
  await expect(taxGroup.locator('.pntab').filter({ hasText: 'Consultar SUNAT' })).toBeVisible();

  await taxGroup.locator('.pntab').filter({ hasText: 'Consultar SUNAT' }).click();
  await expect(page.locator('.module-location')).toBeVisible();
  await expect(page.locator('.module-location button')).toContainText('Ver módulos especializados');
});
