'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const productionMode = Boolean(process.env.PLAYWRIGHT_BASE_URL);

test.describe('servidor desplegado', () => {
  test.skip(!productionMode, 'Estas verificaciones solo se ejecutan contra una URL desplegada.');

  test('la API pública responde saludablemente', async ({ request }) => {
    const response = await request.get('/api/index.php?action=health', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'DeclarafyWeb' },
    });
    expect(response.status()).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({ ok: true, data: { service: 'declarafy-api', status: 'ok' } });
    expect(payload.csrfToken).toEqual(expect.any(String));
  });

  test('producción contiene la versión y los módulos del repositorio', async ({ request }) => {
    const localHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
    const version = localHtml.match(/styles\.css\?v=([0-9-]+)/)?.[1];
    expect(version, 'index.html debe tener una versión de despliegue').toBeTruthy();

    const response = await request.get('/', { headers: { 'Cache-Control': 'no-cache' } });
    expect(response.status()).toBe(200);
    const deployedHtml = await response.text();
    expect(deployedHtml).toContain(`styles.css?v=${version}`);
    expect(deployedHtml).toContain('frontend-polish.css');
    expect(deployedHtml).toContain('frontend-ui.js');
    expect(deployedHtml).toContain('Módulos especializados');
    expect(deployedHtml).toContain('id="ptReferidos"');
    expect(deployedHtml).toContain('Invita, comparte y gana');

    const moduleAssets = [
      '/src/modules/pension-labor-enhancements.js',
      '/src/modules/tax-close-sunat-enhancements.js',
      '/src/modules/business-tools-enhancements.js',
      '/src/modules/accounting-tax-enhancements.js',
      '/src/modules/payroll-labor-enhancements.js',
      '/src/modules/international-tax-trade-enhancements.js',
      '/src/modules/income-regime-enhancements.js',
      '/src/modules/legal-compliance-enhancements.js',
      '/src/modules/specialized-validation-enhancements.js',
      '/src/modules/final-safety-enhancements.js',
    ];
    for (const asset of moduleAssets) {
      const assetResponse = await request.get(asset, { headers: { 'Cache-Control': 'no-cache' } });
      expect(assetResponse.status(), `${asset} debe existir en producción`).toBe(200);
      expect(await assetResponse.text(), `${asset} no debe estar vacío`).not.toHaveLength(0);
    }
  });
});

test.describe('inicio de sesión real opcional', () => {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  test.skip(!productionMode || !email || !password, 'Requiere los secretos E2E_USER_EMAIL y E2E_USER_PASSWORD.');

  test('un usuario de prueba inicia y cierra sesión', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('.hbtn-in').click();
    await page.locator('#lEmail').fill(email);
    await page.locator('#lPass').fill(password);
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await expect(page.locator('#screen-panel')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page.locator('#screen-landing')).toBeVisible();
  });
});
