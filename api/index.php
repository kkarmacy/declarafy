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

if ($method === 'POST' && $action !== 'public_api') require_mutation_security($config);

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
    return hash_equals(strtolower($config['admin_email']), strtolower((string) $user['email']));
}

function raw_json_response(array $payload, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

switch ($action) {
    case 'health':
        require_method('GET');
        respond(['service' => 'declarafy-api', 'status' => 'ok']);

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
        $status = mb_substr(trim((string) ($body['estado'] ?? $body['status'] ?? 'pendiente')), 0, 30);
        $pdo->prepare('UPDATE suggestions SET status = ? WHERE id = ?')->execute([$status, $suggestionId]);
        respond([]);

    case 'generateapikey':
        require_method('POST');
        $id = require_user();
        $user = user_row($pdo, $id);
        if ($user['plan'] !== 'empresa' && !is_admin($config, $user)) fail_request('plan/required', 'Esta función requiere el plan Empresa.', 403);
        $active = $pdo->prepare('SELECT COUNT(*) FROM api_keys WHERE user_id = ? AND revoked_at IS NULL');
        $active->execute([$id]);
        if ((int) $active->fetchColumn() >= 5) fail_request('api-key/limit', 'Puedes tener como máximo 5 API keys activas.', 409);
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
        $stmt = $pdo->prepare('SELECT k.id, k.user_id, u.plan FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.key_hash = ? AND k.revoked_at IS NULL LIMIT 1');
        $stmt->execute([hash('sha256', $rawKey)]);
        $apiKeyRecord = $stmt->fetch();
        if (!$apiKeyRecord || $apiKeyRecord['plan'] !== 'empresa') fail_request('api-key/invalid', 'API key inválida.', 401);
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
        $pdo->prepare('UPDATE users SET message_count = message_count + 1 WHERE id = ?')->execute([$id]);
        respond(['mc' => (int) user_row($pdo, $id)['message_count']]);

    case 'ai':
        require_method('POST');
        $id = require_user();
        rate_limit($pdo, 'ai', 60, 3600);
        $user = user_row($pdo, $id);
        if ($user['plan'] === 'basico' && (int) $user['message_count'] >= 30) fail_request('quota/exceeded', 'Alcanzaste las 30 consultas de tu plan Básico.', 429);
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
        if ($response === false) { error_log('Declarafy Anthropic request failed: ' . curl_error($curl)); curl_close($curl); fail_request('ai/unavailable', 'La IA no respondió. Intenta de nuevo.', 502); }
        curl_close($curl);
        $payload = json_decode($response, true);
        if (!is_array($payload)) fail_request('ai/invalid-response', 'La IA devolvió una respuesta inválida.', 502);
        raw_json_response($payload, $status >= 200 && $status < 600 ? $status : 502);

    default:
        fail_request('request/not-found', 'Operación no encontrada.', 404);
}
