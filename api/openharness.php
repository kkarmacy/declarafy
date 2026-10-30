<?php
declare(strict_types=1);

/**
 * OpenHarness bridge for Declarafy.
 *
 * This endpoint is intentionally disabled unless explicitly configured on the
 * server. It only accepts a bounded tax-assistant task payload and forwards it
 * to a separately hosted, isolated OpenHarness worker. It never executes agent
 * code inside the cPanel PHP process and never exposes worker credentials.
 */
require __DIR__ . '/bootstrap.php';

header('X-Content-Type-Options: nosniff');

function oh_fail(string $code, string $message, int $status): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode(['ok' => false, 'code' => $code, 'message' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if (!in_array($method, ['GET', 'POST'], true)) {
    header('Allow: GET, POST');
    oh_fail('request/method', 'Método no permitido.', 405);
}
if ($method === 'POST') {
    require_mutation_security($config);
}
$userId = require_user();
rate_limit($pdo, $method === 'GET' ? 'openharness-status' : 'openharness', $method === 'GET' ? 60 : 10, 3600);

if (empty($config['openharness_enabled'])
    || !in_array(strtolower((string) $config['openharness_enabled']), ['1', 'true', 'yes', 'on'], true)) {
    oh_fail('openharness/disabled', 'El servicio de agentes todavía no está habilitado.', 503);
}

if (!function_exists('curl_init')) {
    error_log('Declarafy OpenHarness bridge unavailable: PHP cURL extension is missing.');
    oh_fail('openharness/unavailable', 'El servidor no tiene habilitada la extensión necesaria para conectar con los agentes.', 503);
}

$workerUrl = trim((string) ($config['openharness_url'] ?? ''));
$workerToken = trim((string) ($config['openharness_token'] ?? ''));
$parsed = $workerUrl !== '' ? parse_url($workerUrl) : false;
if (!is_array($parsed)
    || strtolower((string) ($parsed['scheme'] ?? '')) !== 'https'
    || empty($parsed['host'])
    || (isset($parsed['port']) && (int) $parsed['port'] !== 443)
    || isset($parsed['user'])
    || isset($parsed['pass'])
    || isset($parsed['query'])
    || isset($parsed['fragment'])
    || preg_match('/^[A-Za-z0-9.-]+$/', (string) ($parsed['host'] ?? '')) !== 1
    || filter_var((string) ($parsed['host'] ?? ''), FILTER_VALIDATE_IP) !== false
    || !in_array(strtolower((string) ($parsed['host'] ?? '')), $config['openharness_allowed_hosts'] ?? [], true)
    || strlen($workerToken) < 32) {
    oh_fail('openharness/not-configured', 'El servicio aislado no está configurado correctamente.', 503);
}

if ($method === 'GET') {
    $jobId = trim((string) ($_GET['job_id'] ?? ''));
    if (preg_match('/^[A-Za-z0-9_-]{16,128}$/', $jobId) !== 1) {
        oh_fail('openharness/job-id', 'Identificador de tarea inválido.', 400);
    }
    if (($_GET['result'] ?? '') === '1') {
        $resultCurl = curl_init(rtrim($workerUrl, '/') . '/internal/jobs/' . rawurlencode($jobId) . '/result');
        curl_setopt_array($resultCurl, [
            CURLOPT_HTTPGET => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_MAXREDIRS => 0,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_HTTPHEADER => [
                'Accept: application/json',
                'Authorization: Bearer ' . $workerToken,
                // The owner is always taken from the authenticated PHP session.
                'X-User-Ref: ' . (string) $userId,
            ],
            CURLOPT_RETURNTRANSFER => true,
        ]);
        $resultResponse = curl_exec($resultCurl);
        $resultCode = (int) curl_getinfo($resultCurl, CURLINFO_HTTP_CODE);
        $resultError = curl_error($resultCurl);
        curl_close($resultCurl);
        if ($resultResponse === false) {
            error_log('Declarafy OpenHarness result lookup failed; user=' . $userId . '; error=' . preg_replace('/[^A-Za-z0-9 _.-]/', '', $resultError));
            oh_fail('openharness/unavailable', 'No se pudo recuperar el resultado de la tarea.', 502);
        }
        if ($resultCode === 404) oh_fail('openharness/not-found', 'No se encontró la tarea.', 404);
        if ($resultCode === 409) oh_fail('openharness/result-not-ready', 'El resultado todavía no está disponible.', 409);
        $resultData = json_decode($resultResponse);
        if ($resultCode !== 200
            || !$resultData instanceof stdClass
            || ($resultData->job_id ?? null) !== $jobId
            || ($resultData->status ?? null) !== 'completed'
            || !property_exists($resultData, 'result')) {
            oh_fail('openharness/result-error', 'No se pudo recuperar el resultado de la tarea.', 502);
        }
        http_response_code(200);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo json_encode(['ok' => true, 'data' => [
            'job_id' => $jobId,
            'status' => 'completed',
            'result' => $resultData->result,
        ]], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    $statusCurl = curl_init(rtrim($workerUrl, '/') . '/v1/jobs/' . rawurlencode($jobId));
    curl_setopt_array($statusCurl, [
        CURLOPT_HTTPGET => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_MAXREDIRS => 0,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_HTTPHEADER => [
            'Accept: application/json',
            'Authorization: Bearer ' . $workerToken,
            // Never trust a client-supplied owner reference; derive it from
            // the authenticated Declarafy session.
            'X-User-Ref: ' . (string) $userId,
        ],
        CURLOPT_RETURNTRANSFER => true,
    ]);
    $statusResponse = curl_exec($statusCurl);
    $statusCode = (int) curl_getinfo($statusCurl, CURLINFO_HTTP_CODE);
    $statusError = curl_error($statusCurl);
    curl_close($statusCurl);
    if ($statusResponse === false) {
        error_log('Declarafy OpenHarness status lookup failed; user=' . $userId . '; error=' . preg_replace('/[^A-Za-z0-9 _.-]/', '', $statusError));
        oh_fail('openharness/unavailable', 'No se pudo consultar el estado de la tarea.', 502);
    }
    if ($statusCode === 404) oh_fail('openharness/not-found', 'No se encontró la tarea.', 404);
    if ($statusCode !== 200) oh_fail('openharness/status-error', 'No se pudo consultar el estado de la tarea.', 502);
    $statusData = json_decode($statusResponse, true);
    $allowedStatuses = ['queued', 'running', 'completed', 'failed', 'cancelled'];
    if (!is_array($statusData)
        || ($statusData['job_id'] ?? null) !== $jobId
        || !in_array($statusData['status'] ?? null, $allowedStatuses, true)
        || !is_string($statusData['task'] ?? null)
        || !is_int($statusData['created_at'] ?? null)
        || !is_int($statusData['updated_at'] ?? null)
        || !is_int($statusData['attempts'] ?? null)
        || !(is_string($statusData['error_code'] ?? null) || ($statusData['error_code'] ?? null) === null)) {
        oh_fail('openharness/invalid-status', 'El servicio devolvió un estado inválido.', 502);
    }
    http_response_code(200);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode(['ok' => true, 'data' => [
        'job_id' => $jobId,
        'task' => $statusData['task'],
        'status' => $statusData['status'],
        'created_at' => $statusData['created_at'],
        'updated_at' => $statusData['updated_at'],
        'attempts' => $statusData['attempts'],
        'error_code' => $statusData['error_code'],
    ]], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$raw = file_get_contents('php://input');
if ($raw === false || strlen($raw) > 100_000) oh_fail('request/too-large', 'La solicitud supera el tamaño permitido.', 413);
$body = json_decode($raw ?: '{}', true);
if (!is_array($body) || array_is_list($body)) oh_fail('request/invalid-json', 'Solicitud inválida.', 400);
if (($body['action'] ?? null) === 'cancel') {
    if (count($body) !== 2 || array_diff(array_keys($body), ['action', 'job_id']) !== []
        || !is_string($body['job_id'] ?? null)
        || preg_match('/^[A-Za-z0-9_-]{16,128}$/', $body['job_id']) !== 1) {
        oh_fail('openharness/cancel-request', 'Solicitud de cancelación inválida.', 400);
    }
    $cancelPayload = json_encode(['user_ref' => (string) $userId], JSON_UNESCAPED_UNICODE);
    $cancelCurl = curl_init(rtrim($workerUrl, '/') . '/internal/jobs/' . rawurlencode($body['job_id']) . '/cancel');
    curl_setopt_array($cancelCurl, [
        CURLOPT_POST => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_MAXREDIRS => 0,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json', 'Authorization: Bearer ' . $workerToken],
        CURLOPT_POSTFIELDS => $cancelPayload,
        CURLOPT_RETURNTRANSFER => true,
    ]);
    $cancelResponse = curl_exec($cancelCurl);
    $cancelCode = (int) curl_getinfo($cancelCurl, CURLINFO_HTTP_CODE);
    $cancelError = curl_error($cancelCurl);
    curl_close($cancelCurl);
    if ($cancelResponse === false) {
        error_log('Declarafy OpenHarness cancellation failed; user=' . $userId . '; error=' . preg_replace('/[^A-Za-z0-9 _.-]/', '', $cancelError));
        oh_fail('openharness/unavailable', 'No se pudo cancelar la tarea.', 502);
    }
    if ($cancelCode === 404) oh_fail('openharness/not-found', 'No se encontró la tarea.', 404);
    if ($cancelCode === 409) oh_fail('openharness/not-cancellable', 'La tarea ya terminó y no puede cancelarse.', 409);
    $cancelData = json_decode($cancelResponse, true);
    if ($cancelCode !== 200 || !is_array($cancelData) || ($cancelData['status'] ?? null) !== 'cancelled') {
        oh_fail('openharness/cancel-error', 'No se pudo cancelar la tarea.', 502);
    }
    http_response_code(200);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode(['ok' => true, 'data' => ['job_id' => $body['job_id'], 'status' => 'cancelled']], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$unknownKeys = array_diff(array_keys($body), ['task', 'input']);
if ($unknownKeys !== []) oh_fail('request/unknown-fields', 'La solicitud contiene campos no permitidos.', 400);

$task = (string) ($body['task'] ?? 'tax_question');
$allowedTasks = ['tax_question', 'document_summary', 'tax_data_analysis'];
if (!in_array($task, $allowedTasks, true)) oh_fail('openharness/task-not-allowed', 'Tipo de tarea no permitido.', 400);

$input = $body['input'] ?? null;
if (!is_array($input) || array_is_list($input)) {
    oh_fail('openharness/input', 'Los datos de la tarea deben ser un objeto.', 400);
}

// Each task has a strict, independent input schema. This prevents the worker
// from receiving arbitrary options, paths, URLs, tool names or provider overrides.
$inputKeys = array_keys($input);
sort($inputKeys, SORT_STRING);
if ($task === 'tax_question') {
    if ($inputKeys !== ['question']
        || !is_string($input['question'] ?? null)
        || trim($input['question']) === ''
        || strlen($input['question']) > 8_000) {
        oh_fail('openharness/input-schema', 'La consulta tributaria no cumple el formato permitido.', 400);
    }
} elseif ($task === 'document_summary') {
    if ($inputKeys !== ['text']
        || !is_string($input['text'] ?? null)
        || trim($input['text']) === ''
        || strlen($input['text']) > 40_000) {
        oh_fail('openharness/input-schema', 'El documento no cumple el formato permitido.', 400);
    }
} elseif ($task === 'tax_data_analysis') {
    if ($inputKeys !== ['data']
        || !is_array($input['data'] ?? null)
        || array_is_list($input['data']) === false
        || count($input['data']) < 1
        || count($input['data']) > 500) {
        oh_fail('openharness/input-schema', 'Los datos para analizar no cumplen el formato permitido.', 400);
    }
}

$encodedInput = json_encode($input, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($encodedInput === false || strlen($encodedInput) > 50_000) oh_fail('openharness/input-too-large', 'Los datos de la tarea superan el límite permitido.', 413);

// Forward only validated task data. User identity is an internal numeric ID;
// the worker must still authenticate this service request independently.
// Clients may provide a stable idempotency key and reuse it for retries of the
// same logical submission. The worker binds the key to user, task and payload.
$idempotencyKey = trim((string) ($_SERVER['HTTP_IDEMPOTENCY_KEY'] ?? ''));
if ($idempotencyKey !== '' && preg_match('/^[0-9a-f]{32}$/', $idempotencyKey) !== 1) {
    oh_fail('request/idempotency-key', 'La clave de idempotencia no tiene un formato válido.', 400);
}
$requestId = $idempotencyKey !== '' ? $idempotencyKey : bin2hex(random_bytes(16));

$payload = json_encode([
    'task' => $task,
    'input' => $input,
    'request_id' => $requestId,
    'user_ref' => (string) $userId,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($payload === false) oh_fail('openharness/encoding', 'No se pudo preparar la tarea.', 400);

$curl = curl_init(rtrim($workerUrl, '/') . '/v1/jobs');
curl_setopt_array($curl, [
    CURLOPT_POST => true,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_MAXREDIRS => 0,
    CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Accept: application/json',
        'Authorization: Bearer ' . $workerToken,
    ],
    CURLOPT_POSTFIELDS => $payload,
]);
$responseBuffer = '';
curl_setopt($curl, CURLOPT_WRITEFUNCTION, static function ($handle, string $chunk) use (&$responseBuffer): int {
    if (strlen($responseBuffer) + strlen($chunk) > 65_536) return 0;
    $responseBuffer .= $chunk;
    return strlen($chunk);
});
$response = curl_exec($curl);
if ($response !== false) $response = $responseBuffer;
$status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
$error = curl_error($curl);
curl_close($curl);

if ($response === false) {
    error_log('Declarafy OpenHarness bridge connection failed; user=' . $userId . '; error=' . preg_replace('/[^A-Za-z0-9 _.-]/', '', $error));
    oh_fail('openharness/unavailable', 'El servicio de agentes no está disponible. Intenta más tarde.', 502);
}
if ($status !== 202) {
    error_log('Declarafy OpenHarness bridge rejected request; user=' . $userId . '; status=' . $status);
    oh_fail('openharness/rejected', 'El servicio de agentes no pudo aceptar la tarea.', $status === 429 ? 429 : 502);
}
$decoded = json_decode($response, true);
if (!is_array($decoded)
    || array_keys($decoded) !== ['job_id']
    || !is_string($decoded['job_id'] ?? null)
    || preg_match('/^[A-Za-z0-9_-]{16,128}$/', $decoded['job_id']) !== 1) {
    error_log('Declarafy OpenHarness bridge returned invalid response; user=' . $userId);
    oh_fail('openharness/invalid-response', 'El servicio de agentes devolvió una respuesta inválida.', 502);
}

// Return only a job receipt, never arbitrary worker fields, credentials or logs.
http_response_code(202);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
echo json_encode([
    'ok' => true,
    'data' => [
        'job_id' => $decoded['job_id'],
        'status' => 'queued',
        'message' => 'La tarea fue enviada al servicio de agentes.',
    ],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
