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
if ($method !== 'POST') {
    header('Allow: POST');
    oh_fail('request/method', 'Método no permitido.', 405);
}
require_mutation_security($config);
$userId = require_user();

if (empty($config['openharness_enabled'])
    || !in_array(strtolower((string) $config['openharness_enabled']), ['1', 'true', 'yes', 'on'], true)) {
    oh_fail('openharness/disabled', 'El servicio de agentes todavía no está habilitado.', 503);
}

$workerUrl = trim((string) ($config['openharness_url'] ?? ''));
$workerToken = trim((string) ($config['openharness_token'] ?? ''));
$parsed = $workerUrl !== '' ? parse_url($workerUrl) : false;
if (!is_array($parsed)
    || strtolower((string) ($parsed['scheme'] ?? '')) !== 'https'
    || empty($parsed['host'])
    || isset($parsed['user'])
    || isset($parsed['pass'])
    || $workerToken === '') {
    oh_fail('openharness/not-configured', 'El servicio aislado no está configurado correctamente.', 503);
}

$raw = file_get_contents('php://input');
if ($raw === false || strlen($raw) > 100_000) oh_fail('request/too-large', 'La solicitud supera el tamaño permitido.', 413);
$body = json_decode($raw ?: '{}', true);
if (!is_array($body)) oh_fail('request/invalid-json', 'Solicitud inválida.', 400);

$task = (string) ($body['task'] ?? 'tax_question');
$allowedTasks = ['tax_question', 'document_summary', 'tax_data_analysis'];
if (!in_array($task, $allowedTasks, true)) oh_fail('openharness/task-not-allowed', 'Tipo de tarea no permitido.', 400);

$input = $body['input'] ?? null;
if (!is_array($input)) oh_fail('openharness/input', 'Los datos de la tarea deben ser un objeto.', 400);
$encodedInput = json_encode($input, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($encodedInput === false || strlen($encodedInput) > 50_000) oh_fail('openharness/input-too-large', 'Los datos de la tarea superan el límite permitido.', 413);

// Forward only validated task data. User identity is an internal numeric ID;
// the worker must still authorize the signed service request independently.
$payload = json_encode([
    'task' => $task,
    'input' => $input,
    'request_id' => bin2hex(random_bytes(16)),
    'user_ref' => (string) $userId,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($payload === false) oh_fail('openharness/encoding', 'No se pudo preparar la tarea.', 400);

$curl = curl_init(rtrim($workerUrl, '/') . '/v1/jobs');
curl_setopt_array($curl, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_MAXREDIRS => 0,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Accept: application/json',
        'Authorization: Bearer ' . $workerToken,
    ],
    CURLOPT_POSTFIELDS => $payload,
]);
$response = curl_exec($curl);
$status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
$error = curl_error($curl);
curl_close($curl);

if ($response === false) {
    error_log('Declarafy OpenHarness bridge connection failed; user=' . $userId . '; error=' . preg_replace('/[^A-Za-z0-9 _.-]/', '', $error));
    oh_fail('openharness/unavailable', 'El servicio de agentes no está disponible. Intenta más tarde.', 502);
}
if ($status < 200 || $status >= 300) {
    error_log('Declarafy OpenHarness bridge rejected request; user=' . $userId . '; status=' . $status);
    oh_fail('openharness/rejected', 'El servicio de agentes no pudo aceptar la tarea.', $status === 429 ? 429 : 502);
}
$decoded = json_decode($response, true);
if (!is_array($decoded) || !isset($decoded['job_id']) || !is_string($decoded['job_id']) || strlen($decoded['job_id']) > 128) {
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
