<?php
declare(strict_types=1);

// NVIDIA API credentials must be configured in Namecheap/cPanel as a private
// server-side environment variable. Never commit the key or send it to browsers.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Método no permitido']);
    exit;
}

$key = getenv('NVIDIA_API_KEY') ?: '';
$model = getenv('NVIDIA_MODEL') ?: 'meta/llama-3.3-70b-instruct';
if ($key === '') {
    http_response_code(503);
    echo json_encode(['error' => 'Configura NVIDIA_API_KEY en el servidor.']);
    exit;
}

$input = json_decode(file_get_contents('php://input') ?: '{}', true);
$message = is_array($input) ? trim((string)($input['message'] ?? '')) : '';
if ($message === '' || strlen($message) > 12000) {
    http_response_code(422);
    echo json_encode(['error' => 'Consulta inválida o demasiado extensa.']);
    exit;
}

$payload = [
    'model' => $model,
    'messages' => [
        ['role' => 'system', 'content' => 'Eres el asistente tributario de Declarafy Perú. No inventes normas, fechas, tasas ni respuestas de SUNAT. Distingue información general de asesoría específica. Si no hay fuente normativa vigente verificable, adviértelo.'],
        ['role' => 'user', 'content' => $message],
    ],
    'temperature' => 0.2,
    'max_tokens' => 1024,
];
$ch = curl_init('https://integrate.api.nvidia.com/v1/chat/completions');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => 45,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $key,
    ],
    CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
]);
$result = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
$decoded = is_string($result) ? json_decode($result, true) : null;
$answer = $decoded['choices'][0]['message']['content'] ?? null;
if ($status < 200 || $status >= 300 || !is_string($answer)) {
    http_response_code(502);
    echo json_encode(['error' => 'NVIDIA no pudo responder.']);
    exit;
}
echo json_encode(['answer' => $answer], JSON_UNESCAPED_UNICODE);
