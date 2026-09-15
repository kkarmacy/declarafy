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

test('los 19 módulos especializados abren contenido real', async ({ page }) => {
  await page.locator('.pntab-featured').click();
  const cards = page.locator('#specializedModuleGrid .specialized-card');
  await expect(cards).toHaveCount(19);

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
