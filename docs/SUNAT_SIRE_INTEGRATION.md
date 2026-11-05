# Declarafy — SUNAT SIRE API integration

## Scope of this change

This branch adds a server-side, authenticated, read-only integration for the official SUNAT SIRE APIs:

- RVIE (book code `140000`): list enabled periods, request the proposal, check the asynchronous ticket and download the generated archive.
- RCE (book code `080000`): the same read-only flow for purchases.
- SUNAT calls are made from PHP on the server. The browser never calls `api-sire.sunat.gob.pe` directly.
- Client ID, Client Secret, RUC, SOL username and SOL password are submitted for each operation. This implementation does not save them in MySQL, `user_kv`, browser storage, or logs.
- The RUC is checked against the signed-in user's profile RUC when the profile already has one.
- Downloads are streamed through a temporary server file, capped at 100 MiB, marked no-store and deleted after the response.

## User setup

1. In SUNAT Operaciones en Línea, open **Credenciales de API SUNAT**.
2. Register/select the URI **MIGE RCE y RVIE - SIRE** for the application and select the Desktop scope described in the current SIRE manual. Keep the client ID and client secret issued by SUNAT.
3. Confirm the application configuration and authorization scope with the current SUNAT SIRE manual. The v32 RVIE / v29 RCE manuals use the OAuth password grant, scope `https://api-sire.sunat.gob.pe`, and `username` formatted as the 11-digit RUC, one space, then the SOL username.
4. In Declarafy > Consultor SUNAT > Conexión oficial SIRE, enter the contributor RUC, API client credentials and SOL credentials.
5. Select RVIE or RCE, load periods, request the proposal, poll the ticket and download the archive once SUNAT reports it is ready.

Credentials remain in the page's input fields while the page is open so the user can complete the sequence. They are not copied to localStorage/sessionStorage or stored by the backend. Clear the fields and close the page after use.

## API routes

All routes require an authenticated Declarafy session, POST, same-origin request validation, CSRF protection and a per-user rate limit.

- `sunat_sire_periods`
- `sunat_sire_proposal`
- `sunat_sire_ticket_status`
- `sunat_sire_download`

The download endpoint accepts only the SUNAT archive metadata returned by the ticket-status operation, validates all parameters, uses a fixed SUNAT host, refuses redirects and limits the downloaded file to 100 MiB.

## Deliberate limitations

This branch does **not** accept proposal, replace proposal, register preliminaries, upload documents, delete records or submit adjustments. These are taxpayer-impacting operations and must have a separate confirmation and audit workflow.

SUNAT's SIRE manuals state that API REST operations requiring a TUS resumable-upload client must be developed in Java. Those upload operations are therefore not falsely represented as implemented by this PHP read-only adapter. A separate Java/TUS component and hosting decision are required before implementing those workflows.

This branch also does not deploy itself to Namecheap and does not perform a live call with taxpayer credentials. Those require an authorized SUNAT application, a taxpayer's SOL credentials and a controlled deployment/test environment.

## Official documentation

- RVIE API manual v32 (updated 30 September 2026; published on SUNAT SIRE manual page): https://cpe.sunat.gob.pe/sites/default/files/2026-10/Manual%20de%20servicios%20Web%20Api%20-%20SIRE_Ventas%20v32.pdf
- RCE API manual v29: https://cpe.sunat.gob.pe/sites/default/files/2026-10/Manual%20de%20servicios%20Web%20Api%20-%20SIRE_Compras%20v29.pdf
- SUNAT SIRE manuals landing page: https://cpe.sunat.gob.pe/node/148
