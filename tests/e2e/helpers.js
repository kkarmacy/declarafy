'use strict';

const TEST_USER = {
  uid: 'e2e-user',
  name: 'Prueba E2E',
  email: 'e2e@declarafy.test',
  plan: 'empresa',
  mc: 0,
  since: '15 sep 2026',
  onboarded: true,
  tourDone: true,
  isAdmin: true,
  regimen: 'rmt',
  sector: 'servicios',
  ruc: '',
};

async function mockAuthenticatedApi(page) {
  await page.route('**/api/index.php**', async route => {
    const action = new URL(route.request().url()).searchParams.get('action') || 'health';
    const dataByAction = {
      health: { service: 'declarafy-api', status: 'ok' },
      session: { user: TEST_USER },
      profile_get: { user: TEST_USER },
      kv_get_all: { items: {} },
      history_get: { items: [] },
      cases_get: { items: [] },
      suggestions_list: { items: [] },
      referrals_overview: {
        code: 'REFE2ETEST',
        link: 'https://declarafy.com/?ref=REFE2ETEST',
        total: 0,
        active: 0,
        rewardMonths: 0,
        leaders: [],
      },
    };

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: dataByAction[action] || {},
        csrfToken: 'playwright-csrf-token',
      }),
    });
  });
}

module.exports = { mockAuthenticatedApi, TEST_USER };
