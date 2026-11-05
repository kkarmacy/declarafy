<?php
declare(strict_types=1);

/**
 * SUNAT SIRE read-only integration.
 * Credentials are accepted per request and are never persisted or logged.
 * API calls stay server-side because SUNAT documents CORS restrictions.
 */

function sunat_sire_book(array $body): array {
    $key = strtolower(trim((string) ($body['book'] ?? '')));
    $books = [
        'rvie' => ['key' => 'rvie', 'code' => '140000', 'label' => 'Registro de Ventas e Ingresos (RVIE)'],
        'rce' => ['key' => 'rce', 'code' => '080000', 'label' => 'Registro de Compras (RCE)'],
    ];
    if (!isset($books[$key])) fail_request('sunat/sire-book', 'Selecciona RVIE o RCE.', 400);
    return $books[$key];
}

function sunat_sire_credentials(array $body, array $user): array {
    $ruc = clean_ruc($body['ruc'] ?? ($user['ruc'] ?? ''));
    $profileRuc = preg_replace('/\D/', '', (string) ($user['ruc'] ?? '')) ?? '';
    if ($profileRuc !== '' && !hash_equals($profileRuc, $ruc)) {
        fail_request('sunat/sire-ruc-mismatch', 'El RUC no coincide con el RUC registrado en tu perfil.', 403);
    }

    $clientId = trim((string) ($body['clientId'] ?? ''));
    $clientSecret = (string) ($body['clientSecret'] ?? '');
    $solUser = trim((string) ($body['solUser'] ?? ''));
    $solPassword = (string) ($body['solPassword'] ?? '');

    if (!preg_match('/^[A-Za-z0-9._-]{8,128}$/', $clientId)) fail_request('sunat/sire-credentials', 'El Client ID de SUNAT no tiene un formato válido.');
    if ($clientSecret === '' || strlen($clientSecret) > 512) fail_request('sunat/sire-credentials', 'Ingresa un Client Secret válido.');
    if ($solUser === '' || strlen($solUser) > 60) fail_request('sunat/sire-credentials', 'Ingresa tu usuario SOL.');
    if ($solPassword === '' || strlen($solPassword) > 200) fail_request('sunat/sire-credentials', 'Ingresa tu Clave SOL.');

    return ['ruc' => $ruc, 'clientId' => $clientId, 'clientSecret' => $clientSecret, 'solUser' => $solUser, 'solPassword' => $solPassword];
}

function sunat_sire_access_token(array $credentials): string {
    $result = remote_form(
        'https://api-seguridad.sunat.gob.pe/v1/clientessol/' . rawurlencode($credentials['clientId']) . '/oauth2/token/',
        [
            'grant_type' => 'password',
            'scope' => 'https://api-sire.sunat.gob.pe',
            'client_id' => $credentials['clientId'],
            'client_secret' => $credentials['clientSecret'],
            'username' => $credentials['ruc'] . $credentials['solUser'],
            'password' => $credentials['solPassword'],
        ],
        25
    );
    $token = (string) ($result['data']['access_token'] ?? '');
    if ($result['status'] < 200 || $result['status'] >= 300 || $token === '') {
        error_log('Declarafy SIRE OAuth rejected; HTTP ' . $result['status']);
        fail_request('sunat/sire-auth-failed', 'SUNAT rechazó la autenticación SIRE. Verifica que la aplicación tenga habilitada la URI “MIGE RCE y RVIE - SIRE” y que las credenciales SOL sean correctas.', 502);
    }
    return $token;
}

function sunat_sire_get_json(string $path, string $token): array {
    if ($path === '' || $path[0] !== '/' || str_contains($path, '://')) {
        fail_request('sunat/sire-path', 'Solicitud SIRE no permitida.', 400);
    }
    $url = 'https://api-sire.sunat.gob.pe' . $path;
    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 35,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPGET => true,
        CURLOPT_HTTPHEADER => [
            'Accept: application/json',
            'Content-Type: application/json',
            'Authorization: Bearer ' . $token,
        ],
    ]);
    $raw = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    $curlError = curl_error($curl);
    curl_close($curl);
    if ($raw === false) {
        error_log('Declarafy SIRE request failed: ' . $curlError);
        fail_request('sunat/sire-connection', 'No se pudo conectar con la API SIRE de SUNAT.', 502);
    }
    $payload = json_decode($raw, true);
    if (!is_array($payload)) {
        error_log('Declarafy SIRE returned non-JSON; HTTP ' . $status);
        fail_request('sunat/sire-response', 'SUNAT devolvió una respuesta no reconocible.', 502);
    }
    if ($status < 200 || $status >= 300) {
        $code = preg_replace('/[^A-Za-z0-9_.-]/', '', (string) ($payload['cod'] ?? 'remote_error'));
        error_log('Declarafy SIRE rejected request; HTTP ' . $status . '; code=' . $code);
        fail_request('sunat/sire-rejected', 'SUNAT no pudo completar la consulta SIRE (HTTP ' . $status . ', código ' . ($code ?: 'remote_error') . ').', 502);
    }
    return $payload;
}

function sunat_sire_period(string $value): string {
    $period = trim($value);
    if (!preg_match('/^\d{6}$/', $period) || (int) substr($period, 4, 2) < 1 || (int) substr($period, 4, 2) > 12) {
        fail_request('sunat/sire-period', 'El periodo debe tener formato AAAAMM.', 400);
    }
    if ($period > date('Ym')) fail_request('sunat/sire-period-future', 'El periodo no puede ser posterior al mes actual.', 400);
    return $period;
}

function sunat_sire_periods_path(array $book): string {
    return '/v1/contribuyente/migeigv/libros/rvierce/padron/web/omisos/' . $book['code'] . '/periodos';
}

function sunat_sire_proposal_path(array $book, string $period, string $fileType): string {
    $period = sunat_sire_period($period);
    if (!in_array($fileType, ['0', '1'], true)) fail_request('sunat/sire-file-type', 'Tipo de archivo no permitido.', 400);
    if ($book['key'] === 'rvie') {
        $path = '/v1/contribuyente/migeigv/libros/rvie/propuesta/web/propuesta/' . $period . '/exportapropuesta';
        return $path . '?' . http_build_query(['codTipoArchivo' => $fileType], '', '&', PHP_QUERY_RFC3986);
    }
    $path = '/v1/contribuyente/migeigv/libros/rce/propuesta/web/propuesta/' . $period . '/exportacioncomprobantepropuesta';
    return $path . '?' . http_build_query(['codTipoArchivo' => $fileType, 'codOrigenEnvio' => '2'], '', '&', PHP_QUERY_RFC3986);
}

function sunat_sire_ticket_path(array $book, array $body): string {
    $from = sunat_sire_period((string) ($body['perIni'] ?? $body['period'] ?? ''));
    $to = sunat_sire_period((string) ($body['perFin'] ?? $body['period'] ?? ''));
    if ($from > $to) fail_request('sunat/sire-period-range', 'El periodo inicial no puede ser posterior al periodo final.', 400);
    $page = filter_var($body['page'] ?? 1, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 10000]]);
    $perPage = filter_var($body['perPage'] ?? 20, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 100]]);
    if ($page === false || $perPage === false) fail_request('sunat/sire-pagination', 'La paginación no es válida.', 400);
    $params = ['perIni' => $from, 'perFin' => $to, 'page' => $page, 'perPage' => $perPage, 'codLibro' => $book['code'], 'codOrigenEnvio' => '2'];
    $ticket = trim((string) ($body['numTicket'] ?? ''));
    if ($ticket !== '') {
        if (!preg_match('/^\d{14}$/', $ticket)) fail_request('sunat/sire-ticket', 'El número de ticket no tiene un formato válido.', 400);
        $params['numTicket'] = $ticket;
    }
    return '/v1/contribuyente/migeigv/libros/rvierce/gestionprocesosmasivos/web/masivo/consultaestadotickets?' .
        http_build_query($params, '', '&', PHP_QUERY_RFC3986);
}

function sunat_sire_download_file(array $book, array $body, string $token): never {
    $period = sunat_sire_period((string) ($body['perTributario'] ?? ''));
    $ticket = trim((string) ($body['numTicket'] ?? ''));
    $process = trim((string) ($body['codProceso'] ?? ''));
    $filename = trim((string) ($body['nomArchivoReporte'] ?? ''));
    $fileType = trim((string) ($body['codTipoArchivoReporte'] ?? 'null'));
    if (!preg_match('/^\d{14}$/', $ticket)) fail_request('sunat/sire-ticket', 'Número de ticket no válido.', 400);
    if (!preg_match('/^\d{1,2}$/', $process)) fail_request('sunat/sire-process', 'Código de proceso no válido.', 400);
    if (!preg_match('/^[A-Za-z0-9_.-]{1,200}$/', $filename) || str_contains($filename, '..')) fail_request('sunat/sire-filename', 'Nombre de archivo no válido.', 400);
    if (!($fileType === 'null' || preg_match('/^\d{1,3}$/', $fileType))) fail_request('sunat/sire-file-type', 'Código de archivo no válido.', 400);

    $params = [
        'nomArchivoReporte' => $filename,
        'codTipoArchivoReporte' => $fileType,
        'perTributario' => $period,
        'codProceso' => $process,
        'numTicket' => $ticket,
        'codLibro' => $book['code'],
    ];
    $url = 'https://api-sire.sunat.gob.pe/v1/contribuyente/migeigv/libros/rvierce/gestionprocesosmasivos/web/masivo/archivoreporte?' .
        http_build_query($params, '', '&', PHP_QUERY_RFC3986);

    $tmp = tempnam(sys_get_temp_dir(), 'declarafy-sire-');
    if ($tmp === false) fail_request('sunat/sire-download', 'No se pudo preparar la descarga.', 500);
    $stream = fopen($tmp, 'wb');
    if ($stream === false) { @unlink($tmp); fail_request('sunat/sire-download', 'No se pudo preparar la descarga.', 500); }
    $bytes = 0;
    $maxBytes = 100 * 1024 * 1024;
    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 120,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPGET => true,
        CURLOPT_HTTPHEADER => ['Accept: application/octet-stream, application/zip, application/json', 'Authorization: Bearer ' . $token],
        CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use ($stream, &$bytes, $maxBytes): int {
            $length = strlen($chunk);
            if ($bytes + $length > $maxBytes) return 0;
            $written = fwrite($stream, $chunk);
            if ($written === false) return 0;
            $bytes += $written;
            return $written;
        },
    ]);
    $ok = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    $curlError = curl_error($curl);
    $contentType = (string) curl_getinfo($curl, CURLINFO_CONTENT_TYPE);
    curl_close($curl);
    fclose($stream);

    if ($ok === false || $status < 200 || $status >= 300 || $bytes === 0 || str_contains(strtolower($contentType), 'json')) {
        $rawError = @file_get_contents($tmp, false, null, 0, 4096);
        @unlink($tmp);
        $errorPayload = is_string($rawError) ? json_decode($rawError, true) : null;
        $sunatCode = is_array($errorPayload) ? preg_replace('/[^A-Za-z0-9_.-]/', '', (string) ($errorPayload['cod'] ?? 'remote_error')) : 'remote_error';
        error_log('Declarafy SIRE download failed; HTTP ' . $status . '; code=' . $sunatCode . '; curl=' . ($curlError !== '' ? 'yes' : 'no'));
        if ($bytes >= $maxBytes || str_contains(strtolower($curlError), 'write')) {
            fail_request('sunat/sire-download-too-large', 'El archivo supera el límite seguro de descarga de 100 MB.', 413);
        }
        fail_request('sunat/sire-download-failed', 'SUNAT no pudo entregar el archivo solicitado (HTTP ' . $status . ').', 502);
    }

    $downloadName = 'Declarafy-SIRE-' . $book['key'] . '-' . $period . '-' . $ticket . '.zip';
    header('Content-Type: ' . (str_contains(strtolower($contentType), 'zip') ? 'application/zip' : 'application/octet-stream'));
    header('Content-Disposition: attachment; filename="' . $downloadName . '"');
    header('Content-Length: ' . (string) filesize($tmp));
    header('Cache-Control: no-store, private');
    header('X-Content-Type-Options: nosniff');
    readfile($tmp);
    @unlink($tmp);
    exit;
}
