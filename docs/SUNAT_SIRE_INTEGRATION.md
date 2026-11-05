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
2. Register/select the URI **MIGE RCE y RVIE - SIRE** for the application and use the client ID and client secret issued by SUNAT. For SIRE v32, select the Desktop registration mode. This is separate from the OAuth scope value.
3. Confirm the application configuration and authorization scope with the current SUNAT SIRE manual. The v32 RVIE / v29 RCE manuals use the OAuth password grant, OAuth scope `https://api-sire.sunat.gob.pe`, and `username` formatted as the 11-digit RUC, one space, then the SOL username.
4. In Declarafy > Consultor SUNAT > Conexión oficial SIRE, enter the contributor RUC, API client credentials and SOL credentials.
5. Enter the RUC, one space and the SOL username in the OAuth identity field (Declarafy composes this automatically). Select RVIE or RCE, load periods, request the proposal, poll the ticket and download the archive once SUNAT reports it is ready.

Credentials remain in the page's input fields while the page is open so the user can complete the sequence. They are not copied to localStorage/sessionStorage or stored by the backend. Clear the fields and close the page after use.

## API routes

All routes require an authenticated Declarafy session, POST, same-origin request validation, CSRF protection and a per-IP rate limit.

- `sunat_sire_periods`
- `sunat_sire_proposal`
- `sunat_sire_registered_period` (RVIE/RCE consolidated registered-book export)
- `sunat_sire_ticket_status`
- `sunat_sire_inconsistency_summary` (RVIE GET; RCE POST, as specified in the manuals)
- `sunat_sire_summary_download` (TXT/CSV)
- `sunat_sire_download` (ticket archive ZIP)

The registered-period export generates a ticket for RVIE (process 23) or RCE (process 01 accepted / 02 replaced). The RCE v29 table specifies `codOrigen=2` for web-service origin, while its example shows `1`; Declarafy follows the table value and this must be confirmed in the authorized live test. The download endpoint accepts only SUNAT archive metadata returned by ticket status, validates parameters, uses a fixed SUNAT host, refuses redirects and limits each downloaded file to 100 MiB. Multi-part archives can be selected individually.

## Deliberate limitations

This branch does **not** accept proposal, replace proposal, register preliminaries, upload documents, delete records or submit adjustments. These are taxpayer-impacting operations and must have a separate confirmation and audit workflow.

SUNAT's SIRE manuals state that API REST operations requiring a TUS resumable-upload client must be developed in Java. Those upload operations are therefore not falsely represented as implemented by this PHP read-only adapter. A separate Java/TUS component and hosting decision are required before implementing those workflows. Namecheap's official policy says Java is not supported on Shared/Reseller hosting and can be installed on VPS/Dedicated servers; do not incur a hosting upgrade until the current plan is confirmed.

Downloaded ZIP archives are now unpacked in the browser and compatible TXT/CSV/XML entries are sent to the existing import preview. The user must review and confirm before records are saved to the dashboard. The importer maps common SIRE column names and automatically previews RVIE TXT / RCE TXT or CSV. RVIE XLS/XLSX, ZIP64, encrypted ZIPs, files without recognizable headers, or unsupported column layouts still require manual conversion or a future format-specific mapping.

This branch also does not deploy itself to Namecheap and does not perform a live call with taxpayer credentials. Those require an authorized SUNAT application, a taxpayer's SOL credentials and a controlled deployment/test environment.

## Official documentation

- RVIE API manual v32 (updated 30 September 2026; published on SUNAT SIRE manual page): https://cpe.sunat.gob.pe/sites/default/files/2026-10/Manual%20de%20servicios%20Web%20Api%20-%20SIRE_Ventas%20v32.pdf
- RCE API manual v29: https://cpe.sunat.gob.pe/sites/default/files/2026-10/Manual%20de%20servicios%20Web%20Api%20-%20SIRE_Compras%20v29.pdf
- SUNAT SIRE manuals landing page: https://cpe.sunat.gob.pe/node/148
- Namecheap Java support policy: https://www.namecheap.com/support/knowledgebase/article.aspx/163/22/do-you-support-java/
