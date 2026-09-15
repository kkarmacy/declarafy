'use strict';

const { test, expect } = require('@playwright/test');

function observeRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', error => failures.push(`JavaScript: ${error.message}`));
  page.on('response', response => {
    const url = new URL(response.url());
    const pageOrigin = page.url() ? new URL(page.url()).origin : '';
    if (url.origin === pageOrigin && response.status() >= 400) {
      failures.push(`HTTP ${response.status()}: ${url.pathname}`);
    }
  });
  return failures;
}

test('la página pública carga con estilos, scripts y sin errores críticos', async ({ page }) => {
  const failures = observeRuntimeFailures(page);
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' });

  expect(response?.status()).toBeLessThan(400);
  await expect(page).toHaveTitle(/DeclaraFY/i);
  await expect(page.locator('#screen-landing')).toBeVisible();
  await expect(page.locator('.hero h1')).toBeVisible();
  await expect(page.locator('link[href*="styles.css"]')).toHaveCount(1);
  await expect(page.locator('script[src*="app.js"]')).toHaveCount(1);

  const presentation = await page.locator('#screen-landing').evaluate(element => ({
    display: getComputedStyle(element).display,
    background: getComputedStyle(document.body).backgroundColor,
    width: element.getBoundingClientRect().width,
  }));
  expect(presentation.display).not.toBe('none');
  expect(presentation.width).toBeGreaterThan(300);
  expect(presentation.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(failures).toEqual([]);
});

test('el formulario de registro valida datos antes de llamar al servidor', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('.hbtn-reg').click();
  await expect(page.locator('#authOv')).toBeVisible();
  await page.locator('#rName').fill('Usuario de prueba');
  await page.locator('#rEmail').fill('usuario@example.com');
  await page.locator('#rPass').fill('clave-segura-1');
  await page.locator('#rPass2').fill('clave-distinta-2');
  await page.getByRole('button', { name: 'Crear cuenta gratis' }).click();
  await expect(page.locator('#authErr')).toContainText('no coinciden');
});

test('la portada móvil no produce desplazamiento horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#screen-landing')).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
});
