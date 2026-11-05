# SUNAT REST API URI and OAuth scope audit

This inventory replaces the old, incorrect test entries for the legacy customs routes `salida`, `autorizacionsalida` and `ingreso`. Those routes are not in the current API SUNAT REST URI registration list and must be treated as separate SOAP/WSDL integrations.

## Eight REST URI entries used by Declarafy

| Service | SUNAT URI path | OAuth `scope` sent by Declarafy | Evidence status |
|---|---|---|---|
| MIGE Gestión Factoring | `/v1/contribuyente/controlcpe` | `https://api-cpe.sunat.gob.pe` | API-CPE host grouping; operation-level confirmation pending |
| MIGE Ventas | `/v1/contribuyente/emisioncpe` | `https://api-cpe.sunat.gob.pe` | API-CPE host grouping; operation-level confirmation pending |
| GRE Emisión de Comprobantes | `/v1/contribuyente/gem` | `https://api-cpe.sunat.gob.pe` | Confirmed by the official GRE manual |
| Control de mensajes y alertas | `/v1/contribuyente/controlmsg` | `https://api-cpe.sunat.gob.pe` | Provisional; must be confirmed with its own operation |
| SSPP Receptor XML | `/v1/contribuyente/enviossp` | `https://api.sunat.gob.pe` | Provisional; must be confirmed with its own operation |
| Consulta ACE | `/v1/controladuanero/programacion` | `https://api.sunat.gob.pe` | Provisional; must be confirmed with its own operation |
| Transmisión de documentos digitalizados | `/v1/controladuanero/documentossustentatorios` | Empty string | Confirmed by the official v1.2 manual |
| MIGE RCE y RVIE - SIRE | `/v1/contribuyente/migeigv` | `https://api-sire.sunat.gob.pe` | Confirmed by the official SIRE RVIE v32 manual |

The administrator's **Prueba de autenticación SUNAT** is only a token-emission check. A received token does not prove that the selected service's business endpoint is authorized or functional. Each provisional scope must be validated with its own harmless, read-only operation and authorized credentials before being marked confirmed.

## Username formatting

- General clientessol services and digitalized documents: `{RUC}{SOL_USER}` (concatenated), as shown in the corresponding SUNAT manuals.
- SIRE: `{RUC} {SOL_USER}` (one space), as explicitly shown in the RVIE v32 / RCE v29 manuals.

The implementation stores this distinction in the SIRE service's `username_separator` field.

## Registration mode

- SIRE RVIE v32 instructs the contributor to select **Desktop** for the URI `MIGE RCE y RVIE - SIRE`.
- The digitalized-documents v1.2 manual permits the OCE to select **Web** when applicable.
- GRE's manual shows **Desktop** in its registration example.

These Desktop/Web registration settings are separate from the OAuth `scope` parameter.

## Excluded legacy SOAP services

The old test options `salida`, `autorizacionsalida` and `ingreso` were removed from the OAuth REST allowlist. SUNAT publishes separate SOAP/WSDL service descriptions and structures for some customs workflows; they must be implemented and tested using their own protocol, WSDL, certificates and message schemas, not by requesting a generic OAuth scope.

## Official references

- SUNAT API registration URI list and digitalized-documents manual v1.2: https://www.sunat.gob.pe/operatividadaduanera/fast/estructuras/2025/manualTransmisionDocDigitalizados-v1-2.pdf
- SUNAT GRE web-services manual: https://cpe.sunat.gob.pe/sites/default/files/inline-files/Manual_Servicios_GRE%20%281%29.pdf
- SUNAT SIRE RVIE API manual v32: https://cpe.sunat.gob.pe/sites/default/files/2026-10/Manual%20de%20servicios%20Web%20Api%20-%20SIRE_Ventas%20v32.pdf
- SUNAT SIRE RCE API manual v29: https://cpe.sunat.gob.pe/sites/default/files/2026-10/Manual%20de%20servicios%20Web%20Api%20-%20SIRE_Compras%20v29.pdf
- SUNAT Aduanas web-service structures / WSDL index: https://www.sunat.gob.pe/operatividadaduanera/sda/webservice/webservice.html
