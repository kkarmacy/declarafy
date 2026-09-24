<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

$action = preg_replace('/[^a-z0-9_]/', '', strtolower((string) ($_GET['action'] ?? 'health')));
$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));

if ($method === 'OPTIONS') {
    header('Allow: GET, POST, OPTIONS');
    http_response_code(204);
    exit;
}

if ($method === 'POST' && !in_array($action, ['public_api', 'culqi_webhook'], true)) require_mutation_security($config);

function require_method(string $expected): void {
    global $method;
    if ($method !== $expected) fail_request('request/method', 'Método no permitido.', 405);
}

function clean_email(mixed $value): string {
    $email = strtolower(trim((string) $value));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254) {
        fail_request('auth/invalid-email', 'Correo inválido.');
    }
    return $email;
}

function clean_password(mixed $value): string {
    $password = (string) $value;
    if (strlen($password) < 8 || strlen($password) > 200) {
        fail_request('auth/weak-password', 'La contraseña debe tener al menos 8 caracteres.');
    }
    return $password;
}

function clean_name(mixed $value): string {
    $name = trim(preg_replace('/\s+/u', ' ', (string) $value) ?? '');
    if ($name === '' || mb_strlen($name) > 120) fail_request('profile/name', 'Ingresa un nombre válido.');
    return $name;
}

function public_id(): string {
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    $hex = bin2hex($bytes);
    return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4) . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20);
}

function json_value(mixed $value, int $maxBytes = 1_000_000): string {
    $json = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false || strlen($json) > $maxBytes) fail_request('data/too-large', 'Los datos exceden el tamaño permitido.', 413);
    return $json;
}

function decoded_json(?string $value, mixed $fallback): mixed {
    if ($value === null || $value === '') return $fallback;
    $decoded = json_decode($value, true);
    return json_last_error() === JSON_ERROR_NONE ? $decoded : $fallback;
}

function is_admin(array $config, array $user): bool {
    return is_superadmin($config, $user);
}

function raw_json_response(array $payload, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function remote_json(string $url, string $method = 'GET', array $headers = [], ?array $body = null, int $timeout = 20): array {
    $curl = curl_init($url);
    $options = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HTTPHEADER => array_merge(['Accept: application/json'], $headers),
    ];
    if ($method !== 'GET') {
        $options[CURLOPT_CUSTOMREQUEST] = $method;
        $options[CURLOPT_POSTFIELDS] = json_encode($body ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
    curl_setopt_array($curl, $options);
    $raw = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    if ($raw === false) {
        $message = curl_error($curl);
        curl_close($curl);
        throw new RuntimeException($message ?: 'Error de conexión remota.');
    }
    curl_close($curl);
    $data = json_decode($raw, true);
    if (!is_array($data)) throw new RuntimeException('El servicio remoto devolvió una respuesta inválida.');
    return ['status' => $status, 'data' => $data];
}

function remote_form(string $url, array $fields, int $timeout = 20): array {
    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Accept: application/json', 'Content-Type: application/x-www-form-urlencoded'],
        CURLOPT_POSTFIELDS => http_build_query($fields, '', '&', PHP_QUERY_RFC3986),
    ]);
    $raw = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    if ($raw === false) {
        $message = curl_error($curl);
        curl_close($curl);
        throw new RuntimeException($message ?: 'Error de conexión remota.');
    }
    curl_close($curl);
    $data = json_decode($raw, true);
    if (!is_array($data)) throw new RuntimeException('El servicio remoto devolvió una respuesta inválida.');
    return ['status' => $status, 'data' => $data];
}

function clean_ruc(mixed $value): string {
    $ruc = preg_replace('/\D/', '', (string) $value) ?? '';
    if (!preg_match('/^(10|15|17|20)[0-9]{9}$/', $ruc)) fail_request('sunat/ruc', 'Ingresa un RUC válido de 11 dígitos.');
    return $ruc;
}

function sunat_cpe_is_configured(array $config): bool {
    return $config['sunat_client_id'] !== ''
        && $config['sunat_client_secret'] !== ''
        && preg_match('/^(10|15|17|20)[0-9]{9}$/', (string) $config['sunat_query_ruc']) === 1;
}

function sunat_validate_cpe(array $config, array $body): array {
    if (!sunat_cpe_is_configured($config)) {
        fail_request('sunat/cpe-not-configured', 'Faltan las credenciales oficiales de Consulta CPE en el servidor.', 503);
    }

    $rucEmisor = clean_ruc($body['ruc'] ?? $body['rucEmisor'] ?? '');
    $codComp = strtoupper(trim((string) ($body['codComp'] ?? $body['tipoComprobante'] ?? '')));
    $serie = strtoupper(trim((string) ($body['numeroSerie'] ?? $body['serie'] ?? '')));
    $numeroRaw = preg_replace('/\D/', '', (string) ($body['numero'] ?? '')) ?? '';
    $fecha = trim((string) ($body['fechaEmision'] ?? ''));
    $monto = $body['monto'] ?? null;

    if (!in_array($codComp, ['01', '03', '04', '07', '08', 'R1', 'R7'], true)) fail_request('sunat/cpe-type', 'Tipo de comprobante inválido.');
    if (!preg_match('/^[A-Z0-9]{4}$/', $serie)) fail_request('sunat/cpe-series', 'La serie debe tener 4 caracteres.');
    if ($numeroRaw === '' || strlen($numeroRaw) > 8) fail_request('sunat/cpe-number', 'El número de comprobante es inválido.');
    $date = DateTimeImmutable::createFromFormat('!d/m/Y', $fecha);
    if (!$date || $date->format('d/m/Y') !== $fecha) fail_request('sunat/cpe-date', 'La fecha de emisión es inválida.');
    if (!is_numeric($monto) || (float) $monto < 0 || (float) $monto > 99999999.99) fail_request('sunat/cpe-amount', 'El monto del comprobante es inválido.');

    $clientId = (string) $config['sunat_client_id'];
    $token = remote_form(
        'https://api-seguridad.sunat.gob.pe/v1/clientesextranet/' . rawurlencode($clientId) . '/oauth2/token/',
        [
            'grant_type' => 'client_credentials',
            'scope' => 'https://api.sunat.gob.pe/v1/contribuyente/contribuyentes',
            'client_id' => $clientId,
            'client_secret' => (string) $config['sunat_client_secret'],
        ],
        20
    );
    $accessToken = (string) ($token['data']['access_token'] ?? '');
    if ($token['status'] < 200 || $token['status'] >= 300 || $accessToken === '') {
        throw new RuntimeException('SUNAT rechazó las credenciales de la aplicación.');
    }

    $queryRuc = (string) $config['sunat_query_ruc'];
    $remote = remote_json(
        'https://api.sunat.gob.pe/v1/contribuyente/contribuyentes/' . rawurlencode($queryRuc) . '/validarcomprobante',
        'POST',
        ['Content-Type: application/json', 'Authorization: Bearer ' . $accessToken],
        [
            'numRuc' => $rucEmisor,
            'codComp' => $codComp,
            'numeroSerie' => $serie,
            'numero' => (int) $numeroRaw,
            'fechaEmision' => $fecha,
            'monto' => round((float) $monto, 2),
        ],
        30
    );
    if ($remote['status'] < 200 || $remote['status'] >= 300) throw new RuntimeException('SUNAT no pudo validar el comprobante.');

    $payload = $remote['data'];
    $data = is_array($payload['data'] ?? null) ? $payload['data'] : [];
    $estadoCp = (string) ($data['estadoCp'] ?? '');
    $estadoRuc = (string) ($data['estadoRuc'] ?? '');
    $condicion = (string) ($data['condDomiRuc'] ?? '');
    $cpLabels = ['0' => 'NO EXISTE', '1' => 'ACEPTADO', '2' => 'ANULADO', '3' => 'AUTORIZADO', '4' => 'NO AUTORIZADO'];
    $rucLabels = ['00' => 'ACTIVO', '01' => 'BAJA PROVISIONAL', '02' => 'BAJA PROVISIONAL DE OFICIO', '03' => 'SUSPENSIÓN TEMPORAL', '10' => 'BAJA DEFINITIVA', '11' => 'BAJA DE OFICIO', '22' => 'INHABILITADO'];
    $conditionLabels = ['00' => 'HABIDO', '09' => 'PENDIENTE', '11' => 'POR VERIFICAR', '12' => 'NO HABIDO', '20' => 'NO HALLADO'];

    return [
        'verificado' => true,
        'valido' => in_array($estadoCp, ['1', '3'], true),
        'estado_cpe' => $cpLabels[$estadoCp] ?? ($estadoCp !== '' ? $estadoCp : 'SIN RESPUESTA'),
        'estado_ruc' => $rucLabels[$estadoRuc] ?? ($estadoRuc !== '' ? $estadoRuc : 'SIN RESPUESTA'),
        'condicion_ruc' => $conditionLabels[$condicion] ?? ($condicion !== '' ? $condicion : 'SIN RESPUESTA'),
        'observaciones' => is_array($data['observaciones'] ?? null) ? $data['observaciones'] : [],
        'mensaje' => (string) ($payload['message'] ?? ''),
        'fuente' => 'SUNAT - Consulta Integrada de Validez de CPE',
    ];
}

switch ($action) {
    case 'health':
        require_method('GET');
        respond(['service' => 'declarafy-api', 'status' => 'ok', 'release' => '2026.09.15-1']);

    case 'sunat_status':
        require_method('GET');
        require_user();
        respond([
            'officialCpe' => sunat_cpe_is_configured($config),
            'externalProvider' => $config['sunat_api_url'] !== '' && $config['sunat_api_token'] !== '',
            'rucPublicUrl' => 'https://e-consultaruc.sunat.gob.pe/',
            'solUrl' => 'https://e-menu.sunat.gob.pe/',
        ]);

    case 'session':
        require_method('GET');
        $user = null;
        if (!empty($_SESSION['user_id'])) {
            try { $user = client_user(user_row($pdo, (int) $_SESSION['user_id'])); }
            catch (Throwable) { unset($_SESSION['user_id']); }
        }
        respond(['user' => $user]);

    case 'register':
        require_method('POST');
        rate_limit($pdo, 'register', 8, 3600);
        $body = request_body();
        $name = clean_name($body['name'] ?? '');
        $email = clean_email($body['email'] ?? '');
        $password = clean_password($body['password'] ?? '');
        $refBy = mb_substr(trim((string) ($body['refBy'] ?? '')), 0, 80);
        $stmt = $pdo->prepare('INSERT INTO users (public_id, name, email, password_hash, ref_by) VALUES (?, ?, ?, ?, ?)');
        try {
            $stmt->execute([public_id(), $name, $email, password_hash($password, PASSWORD_DEFAULT), $refBy]);
        } catch (PDOException $error) {
            if ((string) $error->getCode() === '23000') fail_request('auth/email-already-in-use', 'Ya existe una cuenta con ese correo.', 409);
            throw $error;
        }
        session_regenerate_id(true);
        $_SESSION['user_id'] = (int) $pdo->lastInsertId();
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
        respond(['user' => client_user(user_row($pdo, (int) $_SESSION['user_id']))], 201);

    case 'login':
        require_method('POST');
        rate_limit($pdo, 'login', 12, 900);
        $body = request_body();
        $email = clean_email($body['email'] ?? '');
        $password = (string) ($body['password'] ?? '');
        $stmt = $pdo->prepare('SELECT id, password_hash FROM users WHERE email = ? LIMIT 1');
        $stmt->execute([$email]);
        $record = $stmt->fetch();
        if (!$record || !password_verify($password, $record['password_hash'])) {
            fail_request('auth/invalid-credential', 'Correo o contraseña incorrectos.', 401);
        }
        if (password_needs_rehash($record['password_hash'], PASSWORD_DEFAULT)) {
            $rehash = $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
            $rehash->execute([password_hash($password, PASSWORD_DEFAULT), $record['id']]);
        }
        session_regenerate_id(true);
        $_SESSION['user_id'] = (int) $record['id'];
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
        respond(['user' => client_user(user_row($pdo, (int) $record['id']))]);

    case 'logout':
        require_method('POST');
        $_SESSION = [];
        session_regenerate_id(true);
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
        respond([]);

    case 'recover':
        require_method('POST');
        rate_limit($pdo, 'recover', 5, 3600);
        $body = request_body();
        $email = clean_email($body['email'] ?? '');
        $stmt = $pdo->prepare('SELECT id, name FROM users WHERE email = ? LIMIT 1');
        $stmt->execute([$email]);
        $user = $stmt->fetch();
        if ($user) {
            $token = bin2hex(random_bytes(32));
            $pdo->prepare('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL')->execute([$user['id']]);
            $insert = $pdo->prepare('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 60 MINUTE))');
            $insert->execute([$user['id'], hash('sha256', $token)]);
            $url = $config['app_origin'] . '/reset-password.html?token=' . rawurlencode($token);
            $subject = 'Restablece tu contraseña de DeclaraFY';
            $message = "Hola {$user['name']},\n\nAbre este enlace para crear una nueva contraseña (vence en 60 minutos):\n{$url}\n\nSi no solicitaste este cambio, ignora este mensaje.";
            $headers = 'From: DeclaraFY <' . str_replace(["\r", "\n"], '', $config['mail_from']) . ">\r\nContent-Type: text/plain; charset=UTF-8";
            if (!mail($email, $subject, $message, $headers)) error_log('Declarafy password reset email could not be queued for user ' . $user['id']);
        }
        respond(['message' => 'Si el correo está registrado, recibirás un enlace de recuperación.']);

    case 'reset_password':
        require_method('POST');
        rate_limit($pdo, 'reset', 8, 3600);
        $body = request_body();
        $token = strtolower(trim((string) ($body['token'] ?? '')));
        if (!preg_match('/^[a-f0-9]{64}$/', $token)) fail_request('auth/invalid-reset', 'El enlace no es válido o ya venció.', 400);
        $password = clean_password($body['password'] ?? '');
        $pdo->beginTransaction();
        $stmt = $pdo->prepare('SELECT id, user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() FOR UPDATE');
        $stmt->execute([hash('sha256', $token)]);
        $reset = $stmt->fetch();
        if (!$reset) { $pdo->rollBack(); fail_request('auth/invalid-reset', 'El enlace no es válido o ya venció.', 400); }
        $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([password_hash($password, PASSWORD_DEFAULT), $reset['user_id']]);
        $pdo->prepare('UPDATE password_resets SET used_at = NOW() WHERE id = ?')->execute([$reset['id']]);
        $pdo->commit();
        respond(['message' => 'Contraseña actualizada. Ya puedes iniciar sesión.']);

    case 'profile_get':
        require_method('GET');
        $id = require_user();
        respond(['user' => client_user(user_row($pdo, $id))]);

    case 'profile_update':
        require_method('POST');
        $id = require_user();
        $body = request_body();
        $allowed = [];
        if (array_key_exists('name', $body)) $allowed['name'] = clean_name($body['name']);
        if (array_key_exists('ruc', $body)) {
            $ruc = preg_replace('/\D/', '', (string) $body['ruc']);
            if ($ruc !== '' && strlen($ruc) !== 11) fail_request('profile/ruc', 'El RUC debe tener 11 dígitos.');
            $allowed['ruc'] = $ruc;
        }
        foreach (['regimen' => 80, 'sector' => 120] as $field => $limit) {
            if (array_key_exists($field, $body)) $allowed[$field] = mb_substr(trim((string) $body[$field]), 0, $limit);
        }
        if (array_key_exists('onboarded', $body)) $allowed['onboarded'] = !empty($body['onboarded']) ? 1 : 0;
        if (array_key_exists('tourDone', $body)) $allowed['tour_done'] = !empty($body['tourDone']) ? 1 : 0;
        if ($allowed) {
            $sets = []; $values = [];
            foreach ($allowed as $column => $value) { $sets[] = "{$column} = ?"; $values[] = $value; }
            $values[] = $id;
            $pdo->prepare('UPDATE users SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($values);
        }
        respond(['user' => client_user(user_row($pdo, $id))]);

    case 'reauthenticate':
        require_method('POST');
        $id = require_user();
        $body = request_body();
        $stmt = $pdo->prepare('SELECT password_hash FROM users WHERE id = ?');
        $stmt->execute([$id]);
        if (!password_verify((string) ($body['password'] ?? ''), (string) $stmt->fetchColumn())) fail_request('auth/wrong-password', 'Contraseña actual incorrecta.', 401);
        $_SESSION['reauth_at'] = time();
        respond([]);

    case 'change_password':
        require_method('POST');
        $id = require_user();
        if (time() - (int) ($_SESSION['reauth_at'] ?? 0) > 300) fail_request('auth/requires-recent-login', 'Confirma primero tu contraseña actual.', 401);
        $body = request_body();
        $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([password_hash(clean_password($body['password'] ?? ''), PASSWORD_DEFAULT), $id]);
        unset($_SESSION['reauth_at']);
        respond([]);

    case 'kv_get_all':
        require_method('GET');
        $id = require_user();
        $stmt = $pdo->prepare('SELECT item_key, value_json FROM user_kv WHERE user_id = ?');
        $stmt->execute([$id]);
        $items = [];
        foreach ($stmt->fetchAll() as $row) $items[$row['item_key']] = decoded_json($row['value_json'], null);
        respond(['items' => $items]);

    case 'kv_set':
        require_method('POST');
        $id = require_user();
        $body = request_body();
        $key = (string) ($body['key'] ?? '');
        if (!preg_match('/^[A-Za-z0-9_.:-]{1,190}$/', $key)) fail_request('data/key', 'Clave de datos inválida.');
        $stmt = $pdo->prepare('INSERT INTO user_kv (user_id, item_key, value_json) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)');
        $stmt->execute([$id, $key, json_value($body['value'] ?? null, 250_000)]);
        respond([]);

    case 'history_get':
    case 'cases_get':
        require_method('GET');
        $id = require_user();
        $type = $action === 'history_get' ? 'history' : 'cases';
        $stmt = $pdo->prepare('SELECT value_json FROM user_documents WHERE user_id = ? AND document_type = ?');
        $stmt->execute([$id, $type]);
        respond(['items' => decoded_json($stmt->fetchColumn() ?: null, [])]);

    case 'history_set':
    case 'cases_set':
        require_method('POST');
        $id = require_user();
        $type = $action === 'history_set' ? 'history' : 'cases';
        $body = request_body();
        $items = $body['items'] ?? [];
        if (!is_array($items)) fail_request('data/invalid', 'Datos inválidos.');
        $stmt = $pdo->prepare('INSERT INTO user_documents (user_id, document_type, value_json) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)');
        $stmt->execute([$id, $type, json_value($items)]);
        respond([]);

    case 'suggestions_list':
        require_method('GET');
        $id = require_user();
        $viewer = user_row($pdo, $id);
        if (is_admin($config, $viewer)) {
            $stmt = $pdo->query('SELECT id, content_json, status, created_at FROM suggestions ORDER BY created_at DESC LIMIT 100');
        } else {
            $stmt = $pdo->prepare('SELECT id, content_json, status, created_at FROM suggestions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100');
            $stmt->execute([$id]);
        }
        $items = [];
        foreach ($stmt->fetchAll() as $row) {
            $content = decoded_json($row['content_json'], []);
            $items[] = ['id' => $row['id'], 'status' => $row['status'], 'createdAt' => $row['created_at'], 'data' => array_merge(is_array($content) ? $content : [], ['id' => $row['id'], 'estado' => $row['status']])];
        }
        respond(['items' => $items]);

    case 'admin_overview':
        require_method('GET');
        $id = require_user();
        $viewer = user_row($pdo, $id);
        if (!is_admin($config, $viewer)) fail_request('auth/forbidden', 'Solo el superadministrador puede acceder.', 403);
        rate_limit($pdo, 'admin_overview', 60, 60);
        $rows = $pdo->query('SELECT id, name, email, plan, message_count, created_at FROM users ORDER BY created_at DESC LIMIT 200')->fetchAll();
        $users = array_map(static fn(array $row): array => [
            'id' => (int) $row['id'],
            'name' => (string) $row['name'],
            'email' => (string) $row['email'],
            'plan' => (string) $row['plan'],
            'mc' => (int) $row['message_count'],
            'since' => date('d/m/Y', strtotime((string) $row['created_at'])),
        ], $rows);
        $planCounts = ['basico' => 0, 'pro' => 0, 'empresa' => 0];
        $totalMessages = 0;
        foreach ($users as $user) {
            if (isset($planCounts[$user['plan']])) $planCounts[$user['plan']]++;
            $totalMessages += $user['mc'];
        }
        $topicCounts = [];
        $documents = $pdo->query("SELECT value_json FROM user_documents WHERE document_type = 'history' ORDER BY updated_at DESC LIMIT 500")->fetchAll();
        foreach ($documents as $document) {
            $history = decoded_json($document['value_json'] ?? '', []);
            if (!is_array($history)) continue;
            foreach ($history as $conversation) {
                if (!is_array($conversation)) continue;
                $topic = mb_substr(trim((string) ($conversation['area'] ?? 'General')), 0, 80) ?: 'General';
                $topicCounts[$topic] = ($topicCounts[$topic] ?? 0) + 1;
            }
        }
        arsort($topicCounts);
        $topics = [];
        foreach (array_slice($topicCounts, 0, 6, true) as $name => $count) $topics[] = ['name' => $name, 'count' => $count];
        respond([
            'users' => $users,
            'totals' => [
                'users' => count($users),
                'plans' => $planCounts,
                'messages' => $totalMessages,
                'estimatedMonthlyRevenue' => ($planCounts['pro'] * 190) + ($planCounts['empresa'] * 750),
            ],
            'topics' => $topics,
        ]);

    case 'referrals_overview':
        require_method('GET');
        $id = require_user();
        $viewer = user_row($pdo, $id);
        rate_limit($pdo, 'referrals_overview', 120, 60);
        $rawCode = strtoupper(substr(base64_encode(strtolower((string) $viewer['email'])), 0, 8));
        $code = 'REF' . preg_replace('/[^A-Z0-9]/', 'X', $rawCode);

        $referrals = $pdo->prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN plan <> 'basico' THEN 1 ELSE 0 END) AS active FROM users WHERE ref_by = ?");
        $referrals->execute([$code]);
        $counts = $referrals->fetch() ?: ['total' => 0, 'active' => 0];

        $leaders = [];
        $leaderRows = $pdo->query("SELECT ref_by, COUNT(*) AS total FROM users WHERE ref_by <> '' GROUP BY ref_by ORDER BY total DESC, ref_by ASC LIMIT 5")->fetchAll();
        foreach ($leaderRows as $row) {
            $leaders[] = ['code' => (string) $row['ref_by'], 'total' => (int) $row['total']];
        }
        respond([
            'code' => $code,
            'link' => 'https://declarafy.com/?ref=' . rawurlencode($code),
            'total' => (int) $counts['total'],
            'active' => (int) ($counts['active'] ?? 0),
            'rewardMonths' => (int) ($counts['active'] ?? 0),
            'leaders' => $leaders,
        ]);

    case 'suggestions_create':
        require_method('POST');
        $id = require_user();
        $body = request_body();
        $suggestionId = mb_substr((string) ($body['id'] ?? public_id()), 0, 80);
        if (!preg_match('/^[A-Za-z0-9_-]{1,80}$/', $suggestionId)) $suggestionId = public_id();
        unset($body['id'], $body['estado'], $body['status']);
        $stmt = $pdo->prepare('INSERT INTO suggestions (id, user_id, content_json) VALUES (?, ?, ?)');
        $stmt->execute([$suggestionId, $id, json_value($body, 50_000)]);
        respond(['id' => $suggestionId], 201);

    case 'suggestions_update':
        require_method('POST');
        $id = require_user();
        $viewer = user_row($pdo, $id);
        if (!is_admin($config, $viewer)) fail_request('auth/forbidden', 'Solo el administrador puede actualizar sugerencias.', 403);
        $body = request_body();
        $suggestionId = (string) ($body['id'] ?? '');
        $status = trim((string) ($body['estado'] ?? $body['status'] ?? 'pendiente'));
        if (!in_array($status, ['pendiente', 'revision', 'implementado', 'rechazado'], true)) fail_request('suggestions/status', 'Estado de sugerencia inválido.');
        $pdo->prepare('UPDATE suggestions SET status = ? WHERE id = ?')->execute([$status, $suggestionId]);
        respond([]);

    case 'consultabcrtiposcambio':
        require_method('GET');
        require_user();
        rate_limit($pdo, 'bcr', 30, 60);
        try {
            $remote = remote_json('https://estadisticas.bcrp.gob.pe/estadisticas/series/api/PD04639PD-PD04640PD/json', 'GET', [], null, 15);
            if ($remote['status'] < 200 || $remote['status'] >= 300) fail_request('bcr/unavailable', 'El BCRP no respondió correctamente.', 502);
            $periods = $remote['data']['periods'] ?? [];
            $items = [];
            foreach (array_slice(is_array($periods) ? $periods : [], -10) as $period) {
                $values = $period['values'] ?? [];
                $compra = is_numeric($values[0] ?? null) ? (float) $values[0] : null;
                $venta = is_numeric($values[1] ?? null) ? (float) $values[1] : null;
                if ($compra === null && $venta === null) continue;
                $items[] = ['fecha' => (string) ($period['name'] ?? ''), 'compra' => $compra, 'venta' => $venta, 'precio' => $venta ?? $compra, 'valor' => $venta ?? $compra];
            }
            respond(['data' => array_reverse($items), 'source' => 'BCRP']);
        } catch (Throwable $error) {
            error_log('Declarafy BCRP request failed: ' . $error->getMessage());
            fail_request('bcr/unavailable', 'No se pudo consultar el BCRP en este momento.', 502);
        }

    case 'consultasunatcomprobantes':
        require_method('POST');
        require_user();
        rate_limit($pdo, 'sunat', 20, 60);
        $body = request_body();
        $ruc = clean_ruc($body['ruc'] ?? '');
        $type = (string) ($body['tipo'] ?? 'ruc');
        if (!in_array($type, ['ruc', 'deuda', 'pdt', 'cpe'], true)) fail_request('sunat/type', 'Tipo de consulta SUNAT inválido.');
        try {
            if ($type === 'cpe' && sunat_cpe_is_configured($config)) respond(sunat_validate_cpe($config, $body));
            if ($config['sunat_api_url'] === '' || $config['sunat_api_token'] === '') {
                $message = $type === 'ruc'
                    ? 'La consulta pública de RUC se completa en el portal oficial de SUNAT.'
                    : ($type === 'cpe' ? 'La validación oficial CPE todavía no tiene credenciales configuradas.' : 'Esta información privada requiere ingreso personal a SUNAT Operaciones en Línea.');
                fail_request('sunat/not-configured', $message, 503);
            }
            $remote = remote_json($config['sunat_api_url'], 'POST', [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $config['sunat_api_token'],
            ], ['ruc' => $ruc, 'tipo' => $type], 30);
            if ($remote['status'] < 200 || $remote['status'] >= 300) fail_request('sunat/unavailable', 'SUNAT no respondió correctamente.', 502);
            respond($remote['data']);
        } catch (Throwable $error) {
            error_log('Declarafy SUNAT request failed: ' . $error->getMessage());
            fail_request('sunat/unavailable', 'No se pudo consultar SUNAT en este momento.', 502);
        }

    case 'callalternativeai':
        require_method('POST');
        $id = require_user();
        $user = user_row($pdo, $id);
        if ($user['plan'] === 'basico' && !is_admin($config, $user)) fail_request('plan/required', 'Esta función requiere el plan Profesional o Empresa.', 403);
        rate_limit($pdo, 'alternative_ai', 40, 3600);
        $body = request_body();
        $provider = strtolower((string) ($body['provider'] ?? ''));
        $providers = [
            'openai' => ['key' => $config['openai_api_key'], 'url' => 'https://api.openai.com/v1/chat/completions', 'model' => 'gpt-4.1-mini'],
            'deepseek' => ['key' => $config['deepseek_api_key'], 'url' => 'https://api.deepseek.com/chat/completions', 'model' => 'deepseek-chat'],
        ];
        if (!isset($providers[$provider])) fail_request('ai/provider', 'Proveedor de IA inválido.');
        if ($providers[$provider]['key'] === '') fail_request('ai/not-configured', 'El proveedor seleccionado aún no está configurado.', 503);
        $messages = $body['messages'] ?? [];
        if (!is_array($messages) || count($messages) < 1 || count($messages) > 60) fail_request('ai/messages', 'Conversación inválida.');
        // Validate each message before forwarding it to a paid external provider.
        $cleanMessages = [];
        foreach ($messages as $message) {
            if (!is_array($message) || !in_array($message['role'] ?? '', ['user', 'assistant'], true)
                || !is_string($message['content'] ?? null) || trim($message['content']) === ''
                || mb_strlen($message['content']) > 20000) {
                fail_request('ai/messages', 'Uno o más mensajes tienen un formato inválido.');
            }
            $cleanMessages[] = ['role' => $message['role'], 'content' => $message['content']];
        }
        $system = mb_substr((string) ($body['system'] ?? ''), 0, 20_000);
        if ($system !== '') array_unshift($cleanMessages, ['role' => 'system', 'content' => $system]);
        $request = ['model' => $providers[$provider]['model'], 'messages' => $cleanMessages,
            'max_tokens' => max(64, min(4096, (int) ($body['max_tokens'] ?? 1024)))];
        json_value($request, 1_500_000);
        // Reserve before the external call, as the primary AI endpoint already does.
        $pdo->beginTransaction();
        try {
            $lock = $pdo->prepare('SELECT id FROM users WHERE id = ? FOR UPDATE');
            $lock->execute([$id]);
            if (!$lock->fetch()) throw new RuntimeException('User not found');
            $pdo->prepare('UPDATE users SET message_count = message_count + 1 WHERE id = ?')->execute([$id]);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            error_log('Declarafy alternative AI quota reservation failed: ' . $error->getMessage());
            fail_request('server/database-error', 'No se pudo reservar la consulta.', 503);
        }
        try {
            $remote = remote_json($providers[$provider]['url'], 'POST', [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $providers[$provider]['key'],
            ], $request, 90);
            $text = $remote['status'] >= 200 && $remote['status'] < 300
                ? (string) ($remote['data']['choices'][0]['message']['content'] ?? '') : '';
            if ($text === '') throw new RuntimeException('Empty response or provider failure');
        } catch (Throwable $error) {
            try {
                $pdo->prepare('UPDATE users SET message_count = GREATEST(message_count - 1, 0) WHERE id = ?')->execute([$id]);
            } catch (Throwable $rollbackError) {
                error_log('Declarafy alternative AI quota rollback failed: ' . $rollbackError->getMessage());
            }
            error_log('Declarafy alternative AI failed: ' . $error->getMessage());
            fail_request('ai/unavailable', 'El proveedor de IA no está disponible.', 502);
        }
        respond(['content' => [['type' => 'text', 'text' => $text]]]);

    case 'payments_list':
        require_method('GET');
        $id = require_user();
        $stmt = $pdo->prepare('SELECT provider_charge_id, plan, amount_cents, currency, status, paid_at, created_at FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 24');
        $stmt->execute([$id]);
        $subscription = $pdo->prepare('SELECT plan, status, current_period_end FROM subscriptions WHERE user_id = ? LIMIT 1');
        $subscription->execute([$id]);
        respond(['items' => $stmt->fetchAll(), 'subscription' => $subscription->fetch() ?: null]);

    case 'subscription_cancel':
        require_method('POST');
        $id = require_user();
        $cancel = $pdo->prepare("UPDATE subscriptions SET status = 'cancel_requested' WHERE user_id = ? AND status = 'active'");
        $cancel->execute([$id]);
        respond(['requested' => $cancel->rowCount() > 0]);

    case 'culqi_webhook':
        require_method('POST');
        if ($config['culqi_private_key'] === '') fail_request('payments/not-configured', 'El sistema de pagos aún no está configurado.', 503);
        rate_limit($pdo, 'culqi_webhook', 120, 60);
        $event = request_body();
        $object = $event['data']['object'] ?? $event['object'] ?? [];
        $chargeId = (string) ($object['id'] ?? $event['data']['id'] ?? '');
        if (!preg_match('/^chr_[A-Za-z0-9]+$/', $chargeId)) fail_request('payments/charge', 'Cargo inválido.');
        try {
            $verified = remote_json('https://api.culqi.com/v2/charges/' . rawurlencode($chargeId), 'GET', [
                'Authorization: Bearer ' . $config['culqi_private_key'],
            ], null, 20);
            if ($verified['status'] < 200 || $verified['status'] >= 300) fail_request('payments/unverified', 'No se pudo verificar el cargo.', 502);
            $charge = $verified['data'];
            $outcome = strtolower((string) ($charge['outcome']['type'] ?? ''));
            if (!in_array($outcome, ['venta_exitosa', 'successful', 'success', 'authorized'], true)) fail_request('payments/not-paid', 'El cargo no está confirmado.', 409);
            $currency = strtoupper((string) ($charge['currency_code'] ?? 'PEN'));
            $amount = (int) ($charge['amount'] ?? 0);
            $planMap = [
                19000 => ['plan' => 'pro', 'months' => 1],
                190000 => ['plan' => 'pro', 'months' => 12],
                75000 => ['plan' => 'empresa', 'months' => 1],
                750000 => ['plan' => 'empresa', 'months' => 12],
            ];
            if ($currency !== 'PEN' || !isset($planMap[$amount])) fail_request('payments/amount', 'Monto o moneda no reconocidos.', 422);
            $metadata = is_array($charge['metadata'] ?? null) ? $charge['metadata'] : [];
            $email = clean_email($metadata['email'] ?? $charge['email'] ?? '');
            $find = $pdo->prepare('SELECT id FROM users WHERE email = ? LIMIT 1');
            $find->execute([$email]);
            $userId = (int) $find->fetchColumn();
            if ($userId < 1) fail_request('payments/user', 'No existe un usuario para el correo del pago.', 422);
            $eventId = mb_substr((string) ($event['id'] ?? ('culqi-' . $chargeId)), 0, 100);
            $plan = $planMap[$amount]['plan'];
            $months = $planMap[$amount]['months'];
            $periodEnd = (new DateTimeImmutable('now'))->modify('+' . $months . ' months')->format('Y-m-d H:i:s');
            $pdo->beginTransaction();
            $insert = $pdo->prepare("INSERT INTO payments (user_id, provider_charge_id, provider_event_id, plan, amount_cents, currency, status, paid_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, 'paid', NOW(), ?)");
            try {
                $insert->execute([$userId, $chargeId, $eventId, $plan, $amount, $currency, json_value($charge, 500_000)]);
            } catch (PDOException $error) {
                if ((string) $error->getCode() === '23000') { $pdo->rollBack(); respond(['received' => true, 'duplicate' => true]); }
                throw $error;
            }
            $pdo->prepare('UPDATE users SET plan = ? WHERE id = ?')->execute([$plan, $userId]);
            $pdo->prepare("INSERT INTO subscriptions (user_id, plan, status, current_period_end) VALUES (?, ?, 'active', ?) ON DUPLICATE KEY UPDATE plan = VALUES(plan), status = 'active', current_period_end = VALUES(current_period_end)")->execute([$userId, $plan, $periodEnd]);
            $pdo->commit();
            respond(['received' => true]);
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            error_log('Declarafy Culqi webhook failed: ' . $error->getMessage());
            fail_request('payments/unavailable', 'No se pudo verificar el pago.', 502);
        }

    case 'generateapikey':
        require_method('POST');
        $id = require_user();
        $user = user_row($pdo, $id);
        if ($user['plan'] !== 'empresa' && !is_admin($config, $user)) fail_request('plan/required', 'Esta función requiere el plan Empresa.', 403);
        $active = $pdo->prepare('SELECT COUNT(*) FROM api_keys WHERE user_id = ? AND revoked_at IS NULL');
        $active->execute([$id]);
        if (!is_admin($config, $user) && (int) $active->fetchColumn() >= 5) fail_request('api-key/limit', 'Puedes tener como máximo 5 API keys activas.', 409);
        $body = request_body();
        $label = mb_substr(trim((string) ($body['label'] ?? 'Sin nombre')), 0, 100) ?: 'Sin nombre';
        $keyId = public_id();
        $rawKey = 'tia_live_' . bin2hex(random_bytes(24));
        $keyPrefix = substr($rawKey, 0, 20);
        $insert = $pdo->prepare('INSERT INTO api_keys (id, user_id, label, key_prefix, key_hash) VALUES (?, ?, ?, ?, ?)');
        $insert->execute([$keyId, $id, $label, $keyPrefix, hash('sha256', $rawKey)]);
        respond(['id' => $keyId, 'label' => $label, 'rawKey' => $rawKey], 201);

    case 'listapikeys':
        require_method('POST');
        $id = require_user();
        $stmt = $pdo->prepare('SELECT id, label, key_prefix, created_at, last_used_at, revoked_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC');
        $stmt->execute([$id]);
        $keys = array_map(static fn(array $row): array => [
            'id' => $row['id'], 'label' => $row['label'], 'prefix' => $row['key_prefix'],
            'createdAt' => strtotime($row['created_at']) * 1000,
            'lastUsed' => $row['last_used_at'] ? strtotime($row['last_used_at']) * 1000 : null,
            'revoked' => $row['revoked_at'] !== null,
        ], $stmt->fetchAll());
        respond($keys);

    case 'revokeapikey':
        require_method('POST');
        $id = require_user();
        $body = request_body();
        $stmt = $pdo->prepare('UPDATE api_keys SET revoked_at = NOW() WHERE id = ? AND user_id = ? AND revoked_at IS NULL');
        $stmt->execute([(string) ($body['keyId'] ?? ''), $id]);
        respond([]);

    case 'updatenotifprefs':
        require_method('POST');
        $id = require_user();
        $body = request_body();
        $whatsapp = mb_substr(trim((string) ($body['whatsapp'] ?? '')), 0, 30);
        if ($whatsapp !== '' && !preg_match('/^\+[1-9][0-9]{7,14}$/', $whatsapp)) fail_request('profile/whatsapp', 'Número de WhatsApp inválido.');
        $prefs = ['whatsapp' => $whatsapp, 'notifWhatsapp' => !empty($body['notifWhatsapp'])];
        $stmt = $pdo->prepare('INSERT INTO user_kv (user_id, item_key, value_json) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)');
        $stmt->execute([$id, 'notification_preferences', json_value($prefs, 10_000)]);
        if (array_key_exists('ruc', $body)) {
            $ruc = preg_replace('/\D/', '', (string) $body['ruc']);
            if ($ruc !== '' && strlen($ruc) !== 11) fail_request('profile/ruc', 'El RUC debe tener 11 dígitos.');
            $pdo->prepare('UPDATE users SET ruc = ? WHERE id = ?')->execute([$ruc, $id]);
        }
        respond(['saved' => true]);

    case 'public_api':
        require_method('POST');
        rate_limit($pdo, 'public_api', 30, 60);
        $rawKey = trim((string) ($_SERVER['HTTP_X_API_KEY'] ?? ''));
        if (!preg_match('/^tia_live_[a-f0-9]{48}$/', $rawKey)) fail_request('api-key/invalid', 'API key inválida.', 401);
        $stmt = $pdo->prepare('SELECT k.id, k.user_id, u.plan, u.email FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.key_hash = ? AND k.revoked_at IS NULL LIMIT 1');
        $stmt->execute([hash('sha256', $rawKey)]);
        $apiKeyRecord = $stmt->fetch();
        if (!$apiKeyRecord || ($apiKeyRecord['plan'] !== 'empresa' && !is_admin($config, $apiKeyRecord))) fail_request('api-key/invalid', 'API key inválida.', 401);
        if ($config['anthropic_api_key'] === '') fail_request('ai/not-configured', 'La IA todavía no está configurada en el servidor.', 503);
        $body = request_body();
        $question = trim((string) ($body['question'] ?? ''));
        if ($question === '' || mb_strlen($question) > 8_000) fail_request('api/question', 'La pregunta debe tener entre 1 y 8000 caracteres.');
        $regimen = mb_substr(trim((string) ($body['regimen'] ?? 'general')), 0, 40);
        $request = [
            'model' => 'claude-sonnet-4-5', 'max_tokens' => 1600,
            'system' => 'Eres DeclaraFY, asesor tributario peruano. Responde en español con base legal, advierte incertidumbres y no inventes normas.',
            'messages' => [['role' => 'user', 'content' => "Régimen: {$regimen}\n\n{$question}"]],
        ];
        $curl = curl_init('https://api.anthropic.com/v1/messages');
        curl_setopt_array($curl, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_TIMEOUT => 90,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-api-key: ' . $config['anthropic_api_key'], 'anthropic-version: 2023-06-01'],
            CURLOPT_POSTFIELDS => json_value($request, 100_000)]);
        $response = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
        if ($response === false) { error_log('Declarafy public API failed: ' . curl_error($curl)); curl_close($curl); fail_request('ai/unavailable', 'La IA no respondió.', 502); }
        curl_close($curl);
        $payload = json_decode($response, true);
        if (!is_array($payload)) fail_request('ai/invalid-response', 'La IA devolvió una respuesta inválida.', 502);
        if ($status >= 200 && $status < 300) {
            $pdo->prepare('UPDATE api_keys SET last_used_at = NOW(), request_count = request_count + 1 WHERE id = ?')->execute([$apiKeyRecord['id']]);
            $pdo->prepare('UPDATE users SET message_count = message_count + 1 WHERE id = ?')->execute([$apiKeyRecord['user_id']]);
        }
        raw_json_response($payload, $status >= 200 && $status < 600 ? $status : 502);

    case 'increment_message':
        require_method('POST');
        $id = require_user();
        // Compatibilidad con clientes antiguos: el contador se consume de forma
        // atómica dentro de `ai`, nunca mediante una segunda petición del navegador.
        respond(['mc' => (int) user_row($pdo, $id)['message_count']]);

    case 'ai':
        require_method('POST');
        $id = require_user();
        rate_limit($pdo, 'ai', 60, 3600);
        if ($config['anthropic_api_key'] === '') fail_request('ai/not-configured', 'La IA todavía no está configurada en el servidor.', 503);
        $body = request_body();
        $messages = $body['messages'] ?? [];
        if (!is_array($messages) || count($messages) < 1 || count($messages) > 60) fail_request('ai/messages', 'Conversación inválida.');
        $request = [
            'model' => preg_match('/^[A-Za-z0-9._-]{1,80}$/', (string) ($body['model'] ?? '')) ? $body['model'] : 'claude-sonnet-4-5',
            'max_tokens' => max(64, min(4096, (int) ($body['max_tokens'] ?? 1024))),
            'system' => mb_substr((string) ($body['system'] ?? ''), 0, 20_000),
            'messages' => $messages,
            'stream' => false,
        ];
        $encoded = json_value($request, 1_500_000);
        $pdo->beginTransaction();
        try {
            $quota = $pdo->prepare('SELECT plan, message_count, email FROM users WHERE id = ? FOR UPDATE');
            $quota->execute([$id]);
            $user = $quota->fetch();
            if (!$user) {
                $pdo->rollBack();
                fail_request('auth/session-invalid', 'La sesión ya no es válida.', 401);
            }
            if (!is_admin($config, $user) && $user['plan'] === 'basico' && (int) $user['message_count'] >= 30) {
                $pdo->rollBack();
                fail_request('quota/exceeded', 'Alcanzaste las 30 consultas de tu plan Básico.', 429);
            }
            $pdo->prepare('UPDATE users SET message_count = message_count + 1 WHERE id = ?')->execute([$id]);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            error_log('Declarafy quota reservation failed: ' . $error->getMessage());
            fail_request('server/database-error', 'No se pudo reservar la consulta.', 503);
        }
        $releaseQuota = static function () use ($pdo, $id): void {
            try {
                $pdo->prepare('UPDATE users SET message_count = GREATEST(message_count - 1, 0) WHERE id = ?')->execute([$id]);
            } catch (Throwable $error) {
                error_log('Declarafy quota rollback failed: ' . $error->getMessage());
            }
        };
        $curl = curl_init('https://api.anthropic.com/v1/messages');
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 90,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-api-key: ' . $config['anthropic_api_key'], 'anthropic-version: 2023-06-01'],
            CURLOPT_POSTFIELDS => $encoded,
        ]);
        $response = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
        if ($response === false) { error_log('Declarafy Anthropic request failed: ' . curl_error($curl)); curl_close($curl); $releaseQuota(); fail_request('ai/unavailable', 'La IA no respondió. Intenta de nuevo.', 502); }
        curl_close($curl);
        $payload = json_decode($response, true);
        if (!is_array($payload)) { $releaseQuota(); fail_request('ai/invalid-response', 'La IA devolvió una respuesta inválida.', 502); }
        if ($status < 200 || $status >= 300) $releaseQuota();
        raw_json_response($payload, $status >= 200 && $status < 600 ? $status : 502);

    default:
        fail_request('request/not-found', 'Operación no encontrada.', 404);
}
