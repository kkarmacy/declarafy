<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/prompts.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Método no permitido'], JSON_UNESCAPED_UNICODE);
    exit;
}

$config = declarafy_ai_config();
if ($config['base_url'] === '' || $config['api_key'] === '') {
    http_response_code(503);
    echo json_encode(['error' => 'El servicio de IA aún no está configurado.'], JSON_UNESCAPED_UNICODE);
    exit;
}

$raw = file_get_contents('php://input');
$input = json_decode($raw ?: '{}', true);
if (!is_array($input)) {
    http_response_code(400);
    echo json_encode(['error' => 'JSON inválido'], JSON_UNESCAPED_UNICODE);
    exit;
}

$message = trim((string)($input['message'] ?? ''));
$context = trim((string)($input['context'] ?? ''));

if ($message === '' || mb_strlen($message) > $config['max_input_chars']) {
    http_response_code(422);
    echo json_encode(['error' => 'La consulta está vacía o es demasiado extensa.'], JSON_UNESCAPED_UNICODE);
    exit;
}

$userContent = $message;
if ($context !== '') {
    $userContent = "CONTEXTO VERIFICADO POR DECLARAFY:\n" . mb_substr($context, 0, 16000) .
        "\n\nCONSULTA DEL USUARIO:\n" . $message;
}

$payload = [
    'model' => $config['model'],
    'messages' => [
        ['role' => 'system', 'content' => declarafy_system_prompt()],
        ['role' => 'user', 'content' => $userContent],
    ],
    'temperature' => 0.2,
];

$ch = curl_init($config['base_url'] . '/v1/chat/completions');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => $config['timeout'],
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $config['api_key'],
    ],
    CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
]);

$response = curl_exec($ch);
$status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
curl_close($ch);

if ($response === false || $error !== '') {
    http_response_code(502);
    echo json_encode(['error' => 'No se pudo contactar al servicio de IA.'], JSON_UNESCAPED_UNICODE);
    exit;
}

$data = json_decode($response, true);
$text = $data['choices'][0]['message']['content'] ?? null;

if ($status < 200 || $status >= 300 || !is_string($text) || trim($text) === '') {
    http_response_code(502);
    echo json_encode(['error' => 'El servicio de IA no devolvió una respuesta válida.'], JSON_UNESCAPED_UNICODE);
    exit;
}

echo json_encode([
    'answer' => trim($text),
    'model' => $data['model'] ?? $config['model'],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
