# Declarafy Mobile MVP

First mobile foundation for Declarafy, built with Expo + React Native + TypeScript.

## Included
- Welcome screen
- Login UI
- Mobile dashboard
- Initial module cards: IA Fiscal, Calendario SUNAT, Consulta RUC, Calculadoras, Multas y TIM, Fraccionamiento
- Shared API base configuration

## Safety
This first commit does not alter the existing Declarafy web application or database. Login is UI-only until the existing PHP authentication/API contract is confirmed.

## Run
1. cd mobile
2. npm install
3. npm start

## Next implementation
1. Confirm the production PHP API endpoints and auth/session strategy.
2. Implement secure login/token storage.
3. Connect dashboard profile/plan data.
4. Connect IA Fiscal and RUC endpoints.
5. Add SUNAT calendar and notifications.
