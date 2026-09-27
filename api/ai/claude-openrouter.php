<?php
declare(strict_types=1);

// OpenRouter key (sk-or-v1-...) for Claude models.
// Set OPENROUTER_API_KEY and OPENROUTER_CLAUDE_MODEL privately on the server.
// Never commit API keys or expose them to frontend JavaScript.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Método no permitido']);
    exit;
}

$key = getenv('OPENROUTER_API_KEY') ?: '';
$model = getenv('OPENROUTER_CLAUDE_MODEL') ?: '';
if ($key === '' || $model === '') {
    http_response_code(503);
    echo json_encode(['error' => 'Configura OPENROUTER_API_KEY y OPENROUTER_CLAUDE_MODEL en el servidor.']);
    exit;
}

$input = json_decode(file_get_contents('php://input') ?: '{}', true);
$message = is_array($input) && is_string($input['message'] ?? null) ? trim($input['message']) : '';
if ($message === '' || strlen($message) > 12000) {
    http_response_code(422);
    echo json_encode(['error' => 'Consulta inválida o demasiado extensa.']);
    exit;
}

$payload = [
    'model' => $model,
    'messages' => [
        ['role' => 'system', 'content' => 'Eres el asistente tributario de Declarafy Perú. No inventes normas, tasas, fechas ni datos de SUNAT. Cuando no tengas fuentes verificables, explica la incertidumbre.'],
        ['role' => 'user', 'content' => $message],
    ],
    'max_tokens' => 1024,
    'temperature' => 0.2,
];

$ch = curl_init('https://openrouter.ai/api/v1/chat/completions');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => 45,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $key,
        'HTTP-Referer: https://www.declarafy.com',
        'X-Title: Declarafy',
    ],
    CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
]);
$response = curl_exec($ch);
$status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
$data = is_string($response) ? json_decode($response, true) : null;
$answer = $data['choices'][0]['message']['content'] ?? null;
if ($status < 200 || $status >= 300 || !is_string($answer) || trim($answer) === '') {
    http_response_code(502);
    echo json_encode(['error' => 'OpenRouter/Claude no pudo responder.']);
    exit;
}
echo json_encode(['answer' => trim($answer), 'provider' => 'openrouter', 'model' => $model], JSON_UNESCAPED_UNICODE);
