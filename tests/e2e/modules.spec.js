'use strict';

const { test, expect } = require('@playwright/test');
const { mockAuthenticatedApi } = require('./helpers');

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

test('la barra de módulos se presenta en orden alfabético', async ({ page }) => {
  const result = await page.evaluate(() => {
    const clean = value => value.normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/^[^A-Za-z0-9]+/, '')
      .trim();
    const labels = Array.from(document.querySelectorAll('.pnav > .pntab'))
      .filter(button => !/setPTab\('(inicio|especializados)'/.test(button.getAttribute('onclick') || ''))
      .map(button => clean(button.textContent));
    const expected = [...labels].sort(new Intl.Collator('es', { sensitivity: 'base', numeric: true }).compare);
    return { labels, expected };
  });

  expect(result.labels).toEqual(result.expected);
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
