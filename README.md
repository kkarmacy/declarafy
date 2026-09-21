<p align="center">
  <img src="declarafy-logo.svg" alt="Declarafy" width="320">
</p>

# Declarafy

**AI-powered TaxTech platform for Peruvian SMEs and entrepreneurs**

[![Website](https://img.shields.io/badge/Website-declarafy.com-0A66C2)](https://declarafy.com)
[![Peru](https://img.shields.io/badge/Market-Peru-D91023)](#what-declarafy-does)
[![PHP](https://img.shields.io/badge/Backend-PHP%208.3-777BB4?logo=php&logoColor=white)](https://www.php.net/)
[![MySQL](https://img.shields.io/badge/Database-MySQL%20%2F%20MariaDB-4479A1?logo=mysql&logoColor=white)](https://www.mysql.com/)
[![Playwright](https://img.shields.io/badge/E2E-Playwright-2EAD33?logo=playwright&logoColor=white)](https://playwright.dev/)

Declarafy is a TaxTech platform designed to make Peruvian tax, accounting and compliance workflows easier to understand and manage for **SMEs, entrepreneurs and professional users**.

The project combines structured tax tools, regulatory information, calculators, workflow modules and AI-assisted functionality in a single web platform.

🌐 **Production:** https://declarafy.com

---

## 🇵🇪 What Declarafy Does

Declarafy is designed around practical business and tax workflows, including areas such as:

- RUC and taxpayer information
- SUNAT-related workflows
- Tax calendars and deadlines
- Tax and labor calculations
- Financial and accounting analysis
- Regulatory monitoring
- Tax documentation
- Payment and plan workflows
- Referral functionality
- Specialized business and tax modules
- AI-assisted tax information and decision support

The platform is built for the Peruvian market and continues to expand its module coverage.

---

## 🧩 Current Platform Areas

The repository includes functionality and supporting work for:

| Area | Examples |
|---|---|
| Tax Compliance | SUNAT, PDT-related workflows, tax calendars and alerts |
| Tax Analysis | Corporate and individual tax support modules |
| Labor & Payroll | AFP, ONP, CTS, gratuities and related calculations |
| Business Finance | Cash flow, financial analysis and company valuation |
| Regulatory Intelligence | Regulatory monitoring and update workflows |
| Documentation | Reports, letters and legal/tax document support |
| Payments | Culqi-backed plan activation workflow |
| Integrations | SUNAT credentials and API-ready integration points |
| Referral Program | User referral and commercial growth functionality |
| Testing | Static tests, deployment verification and Playwright E2E |

---

## 🏗 Architecture

Declarafy currently uses a deployment architecture designed for standard shared hosting:

- **Frontend:** HTML, CSS and JavaScript
- **Backend:** PHP 8.3
- **Database:** MySQL / MariaDB
- **Hosting target:** Namecheap / cPanel
- **E2E testing:** Playwright
- **Payments:** Culqi integration
- **SUNAT:** public RUC workflows plus official credential-based integration points
- **Progressive Web App assets:** service worker, manifest and icons

Firebase is **not required** for the current registration, login or data-storage flow.

---

## 📂 Repository Structure

Important areas include:

- `api/` — backend endpoints, configuration and database schema
- `src/` — structured application source
- `tests/` — automated tests
- `scripts/` — deployment and validation utilities
- `docs/` — project documentation
- `index.html` — main web application
- `app.js` — application logic
- `styles.css` — main styles
- `sw.js` — service worker
- `NAMECHEAP_DEPLOYMENT.md` — production deployment guide
- `TESTING.md` — test strategy and commands
- `FRONTEND_REVIEW.md` — frontend review notes

---

## 🧪 Testing

Install dependencies:

```bash
npm ci
```

Run static and deployment-structure checks:

```bash
npm test
```

Run local E2E tests:

```bash
npx playwright install chromium
npm run test:e2e
```

Run E2E tests against production:

```bash
npm run test:e2e:production
```

The repository also includes GitHub Actions coverage for automated testing and production smoke testing.

---

## 🚀 Deployment

Production deployment uses **PHP 8.3 + MySQL/MariaDB** on Namecheap/cPanel.

See:

**[NAMECHEAP_DEPLOYMENT.md](NAMECHEAP_DEPLOYMENT.md)**

That guide covers:

- Database creation
- Schema import
- Server configuration
- API keys and credentials
- SUNAT integration settings
- Culqi webhook configuration
- Production health checks

Sensitive local configuration such as `config.local.php` should never be committed to GitHub.

---

## 🔐 Security Principles

The project is structured around several important controls:

- Server-side handling of sensitive API keys
- Database-backed authentication
- Separation of local secrets from the repository
- Server-side payment verification before plan activation
- Dedicated E2E test credentials rather than administrator credentials
- Production health checks
- Automated deployment-structure validation

Security-sensitive workflows should be reviewed before production changes.

---

## 🗺 Product Direction

Current development priorities include:

- Improving specialized tax modules
- Expanding SUNAT-connected functionality
- Strengthening AI-assisted tax workflows
- Improving mobile usability
- Increasing automated test coverage
- Consolidating backend architecture
- Improving reporting and executive outputs
- Expanding regulatory monitoring
- Improving referral and commercial workflows

---

## ⚠️ Important Disclaimer

Declarafy is a technology platform intended to support tax, accounting and business workflows.

Information generated or displayed by the platform should not automatically be treated as individualized legal, accounting or tax advice. Users should verify material tax decisions against official SUNAT sources and, where appropriate, consult a qualified professional.

---

## 👤 Project

Created and developed under the direction of **Christian Dobrofsky**.

GitHub: [@kkarmacy](https://github.com/kkarmacy)  
Website: [declarafy.com](https://declarafy.com)
