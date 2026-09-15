<?php
declare(strict_types=1);

function env_value(string $name, mixed $fallback = null): mixed {
    $value = getenv($name);
    return ($value === false || $value === '') ? $fallback : $value;
}

$localConfig = __DIR__ . '/config.local.php';
$fileConfig = is_file($localConfig) ? require $localConfig : [];
$config = [
    'db_host' => env_value('DECLARAFY_DB_HOST', $fileConfig['db_host'] ?? 'localhost'),
    'db_port' => (int) env_value('DECLARAFY_DB_PORT', $fileConfig['db_port'] ?? 3306),
    'db_name' => env_value('DECLARAFY_DB_NAME', $fileConfig['db_name'] ?? ''),
    'db_user' => env_value('DECLARAFY_DB_USER', $fileConfig['db_user'] ?? ''),
    'db_password' => env_value('DECLARAFY_DB_PASSWORD', $fileConfig['db_password'] ?? ''),
    'app_origin' => rtrim((string) env_value('DECLARAFY_APP_ORIGIN', $fileConfig['app_origin'] ?? 'https://declarafy.com'), '/'),
    'admin_email' => strtolower((string) env_value('DECLARAFY_ADMIN_EMAIL', $fileConfig['admin_email'] ?? 'christian@declarafy.com')),
    'anthropic_api_key' => (string) env_value('ANTHROPIC_API_KEY', $fileConfig['anthropic_api_key'] ?? ''),
    'openai_api_key' => (string) env_value('OPENAI_API_KEY', $fileConfig['openai_api_key'] ?? ''),
    'deepseek_api_key' => (string) env_value('DEEPSEEK_API_KEY', $fileConfig['deepseek_api_key'] ?? ''),
    'sunat_api_url' => rtrim((string) env_value('DECLARAFY_SUNAT_API_URL', $fileConfig['sunat_api_url'] ?? ''), '/'),
    'sunat_api_token' => (string) env_value('DECLARAFY_SUNAT_API_TOKEN', $fileConfig['sunat_api_token'] ?? ''),
    'sunat_client_id' => trim((string) env_value('DECLARAFY_SUNAT_CLIENT_ID', $fileConfig['sunat_client_id'] ?? '')),
    'sunat_client_secret' => (string) env_value('DECLARAFY_SUNAT_CLIENT_SECRET', $fileConfig['sunat_client_secret'] ?? ''),
    'sunat_query_ruc' => preg_replace('/\D/', '', (string) env_value('DECLARAFY_SUNAT_QUERY_RUC', $fileConfig['sunat_query_ruc'] ?? '')),
    'culqi_private_key' => (string) env_value('CULQI_PRIVATE_KEY', $fileConfig['culqi_private_key'] ?? ''),
    'mail_from' => (string) env_value('DECLARAFY_MAIL_FROM', $fileConfig['mail_from'] ?? 'no-reply@declarafy.com'),
];

if ($config['db_name'] === '' || $config['db_user'] === '' || $config['db_password'] === '') {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'code' => 'server/not-configured', 'message' => 'La base de datos todavía no está configurada.']);
    exit;
}

$secureCookie = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
session_name('declarafy_session');
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'secure' => $secureCookie,
    'httponly' => true,
    'samesite' => 'Lax',
]);
ini_set('session.use_strict_mode', '1');
ini_set('session.use_only_cookies', '1');
session_start();

if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32));

set_exception_handler(static function (Throwable $error): void {
    error_log('Declarafy unhandled API error: ' . $error->getMessage());
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
    }
    echo json_encode([
        'ok' => false,
        'code' => 'server/internal',
        'message' => 'No pudimos completar la operación. Intenta nuevamente.',
        'csrfToken' => $_SESSION['csrf'] ?? '',
    ], JSON_UNESCAPED_UNICODE);
});

try {
    $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $config['db_host'], $config['db_port'], $config['db_name']);
    $pdo = new PDO($dsn, $config['db_user'], $config['db_password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
} catch (Throwable $error) {
    error_log('Declarafy database connection failed: ' . $error->getMessage());
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'code' => 'server/database-unavailable', 'message' => 'El servicio de datos no está disponible.']);
    exit;
}

/**
 * Apply the small, idempotent schema additions required by the running code.
 * This prevents an uploaded backend update from breaking authentication when a
 * cPanel database has not yet received the matching optional billing tables.
 */
function ensure_runtime_schema(PDO $pdo): void {
    $version = 2;
    if ((int) ($_SESSION['runtime_schema_version'] ?? 0) >= $version) return;

    $statements = [
        "CREATE TABLE IF NOT EXISTS payments (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          user_id BIGINT UNSIGNED NOT NULL,
          provider VARCHAR(30) NOT NULL DEFAULT 'culqi',
          provider_charge_id VARCHAR(100) NOT NULL,
          provider_event_id VARCHAR(100) NOT NULL,
          plan ENUM('pro','empresa') NOT NULL,
          amount_cents INT UNSIGNED NOT NULL,
          currency CHAR(3) NOT NULL DEFAULT 'PEN',
          status ENUM('paid','refunded','failed') NOT NULL DEFAULT 'paid',
          paid_at DATETIME NULL,
          payload_json MEDIUMTEXT NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_payments_event (provider_event_id),
          UNIQUE KEY uq_payments_charge (provider_charge_id),
          KEY idx_payments_user (user_id),
          CONSTRAINT fk_payments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS subscriptions (
          user_id BIGINT UNSIGNED NOT NULL,
          provider VARCHAR(30) NOT NULL DEFAULT 'culqi',
          provider_subscription_id VARCHAR(100) NOT NULL DEFAULT '',
          plan ENUM('basico','pro','empresa') NOT NULL DEFAULT 'basico',
          status ENUM('active','cancel_requested','cancelled') NOT NULL DEFAULT 'active',
          current_period_end DATETIME NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id),
          CONSTRAINT fk_subscriptions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
    ];

    try {
        foreach ($statements as $statement) $pdo->exec($statement);
        $_SESSION['runtime_schema_version'] = $version;
    } catch (Throwable $error) {
        // Authentication can still operate without the optional billing tables.
        error_log('Declarafy automatic schema update failed: ' . $error->getMessage());
    }
}

ensure_runtime_schema($pdo);

function respond(array $data = [], int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode(['ok' => $status < 400, 'data' => $data, 'csrfToken' => $_SESSION['csrf']], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail_request(string $code, string $message, int $status = 400): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode(['ok' => false, 'code' => $code, 'message' => $message, 'csrfToken' => $_SESSION['csrf']], JSON_UNESCAPED_UNICODE);
    exit;
}

function request_body(): array {
    $raw = file_get_contents('php://input');
    if ($raw === false || strlen($raw) > 2_000_000) fail_request('request/too-large', 'La solicitud es demasiado grande.', 413);
    $data = json_decode($raw ?: '{}', true);
    if (!is_array($data)) fail_request('request/invalid-json', 'Solicitud inválida.');
    return $data;
}

function require_mutation_security(array $config): void {
    if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'DeclarafyWeb') fail_request('request/forbidden', 'Solicitud no autorizada.', 403);
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '') {
        $originHost = strtolower((string) parse_url($origin, PHP_URL_HOST));
        $requestHost = strtolower(explode(':', $_SERVER['HTTP_HOST'] ?? '')[0]);
        if ($originHost === '' || !hash_equals($requestHost, $originHost)) fail_request('request/origin', 'Origen no autorizado.', 403);
    }
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if ($token === '' || !hash_equals($_SESSION['csrf'], $token)) fail_request('request/csrf', 'La sesión expiró. Recarga la página.', 419);
}

function require_user(): int {
    $id = (int) ($_SESSION['user_id'] ?? 0);
    if ($id < 1) fail_request('auth/required', 'Debes iniciar sesión.', 401);
    return $id;
}

function user_row(PDO $pdo, int $id): array {
    // Las membresías pagadas no quedan activas indefinidamente si el período vence.
    try {
        $expire = $pdo->prepare("UPDATE users u JOIN subscriptions s ON s.user_id = u.id SET u.plan = 'basico', s.status = 'cancelled' WHERE u.id = ? AND s.current_period_end IS NOT NULL AND s.current_period_end <= NOW() AND s.status IN ('active', 'cancel_requested')");
        $expire->execute([$id]);
    } catch (PDOException $error) {
        // A missing optional billing table must never block login or registration.
        if ((string) $error->getCode() !== '42S02') throw $error;
        error_log('Declarafy subscriptions table is pending; continuing authentication.');
    }
    $stmt = $pdo->prepare('SELECT id, public_id, name, email, plan, message_count, created_at, onboarded, tour_done, regimen, sector, ruc, ref_by FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $user = $stmt->fetch();
    if (!$user) fail_request('auth/session-invalid', 'La sesión ya no es válida.', 401);
    return $user;
}

function is_superadmin(array $config, array $user): bool {
    return isset($user['email'])
        && hash_equals(strtolower((string) $config['admin_email']), strtolower((string) $user['email']));
}

function client_user(array $row): array {
    global $config;
    $admin = is_superadmin($config, $row);
    return [
        'uid' => $row['public_id'],
        'name' => $row['name'],
        'email' => $row['email'],
        'plan' => $row['plan'],
        'mc' => (int) $row['message_count'],
        'since' => date('d M Y', strtotime($row['created_at'])),
        'createdAt' => date(DATE_ATOM, strtotime($row['created_at'])),
        'onboarded' => (bool) $row['onboarded'],
        'tourDone' => (bool) $row['tour_done'],
        'regimen' => $row['regimen'] ?? '',
        'sector' => $row['sector'] ?? '',
        'ruc' => $row['ruc'] ?? '',
        'refBy' => $row['ref_by'] ?? '',
        'isAdmin' => $admin,
        'effectivePlan' => $admin ? 'empresa' : $row['plan'],
    ];
}

function rate_limit(PDO $pdo, string $action, int $limit, int $seconds): void {
    $identity = hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? 'unknown') . '|' . $action);
    $bucket = (int) floor(time() / $seconds);
    $stmt = $pdo->prepare('INSERT INTO rate_limits (identity_hash, action_name, bucket_id, attempts) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE attempts = attempts + 1');
    $stmt->execute([$identity, $action, $bucket]);
    $check = $pdo->prepare('SELECT attempts FROM rate_limits WHERE identity_hash = ? AND action_name = ? AND bucket_id = ?');
    $check->execute([$identity, $action, $bucket]);
    if ((int) $check->fetchColumn() > $limit) fail_request('auth/too-many-requests', 'Demasiados intentos. Espera unos minutos.', 429);
}
