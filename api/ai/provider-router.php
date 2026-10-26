<?php
declare(strict_types=1);

/**
 * Server-only, allowlisted AI provider adapter for Declarafy.
 * This file does not expose an HTTP endpoint and does not execute unless included
 * by a caller. Keep provider credentials in private server configuration.
 */

function declarafy_ai_provider_config(array $config, string $provider): array {
    $providers = [
        'anthropic' => [
            'key' => (string) ($config['anthropic_api_key'] ?? ''),
            'url' => 'https://api.anthropic.com/v1/messages',
            'model' => (string) ($config['anthropic_model'] ?? 'claude-3-5-haiku-latest'),
        ],
        'openai' => [
            'key' => (string) ($config['openai_api_key'] ?? ''),
            'url' => 'https://api.openai.com/v1/chat/completions',
            'model' => (string) ($config['openai_model'] ?? 'gpt-4o-mini'),
        ],
        'deepseek' => [
            'key' => (string) ($config['deepseek_api_key'] ?? ''),
            'url' => 'https://api.deepseek.com/chat/completions',
            'model' => (string) ($config['deepseek_model'] ?? 'deepseek-chat'),
        ],
    ];
    if (!isset($providers[$provider])) {
        throw new InvalidArgumentException('Proveedor de IA no permitido.');
    }
    if ($providers[$provider]['key'] === '') {
        throw new RuntimeException('Proveedor de IA no configurado.');
    }
    return $providers[$provider];
}

/**
 * Sends one bounded text request to an explicitly selected provider.
 * Caller must enforce authentication, CSRF, quota/rate limits and feature flags.
 * Returns normalized text/provider/model; never returns headers or credentials.
 */
function declarafy_ai_complete(array $config, string $provider, string $system, string $userText): array {
    if (!function_exists('curl_init')) {
        throw new RuntimeException('El servidor no tiene cURL habilitado.');
    }
    if (strlen($system) > 12000 || strlen($userText) > 30000) {
        throw new InvalidArgumentException('La consulta excede el tamaño permitido.');
    }
    if (trim($userText) === '') {
        throw new InvalidArgumentException('La consulta está vacía.');
    }
    $providerConfig = declarafy_ai_provider_config($config, $provider);
    $headers = ['Accept: application/json', 'Content-Type: application/json'];
    if ($provider === 'anthropic') {
        $headers[] = 'x-api-key: ' . $providerConfig['key'];
        $headers[] = 'anthropic-version: 2023-06-01';
        $payload = [
            'model' => $providerConfig['model'],
            'max_tokens' => 1200,
            'system' => $system,
            'messages' => [['role' => 'user', 'content' => $userText]],
        ];
    } else {
        $headers[] = 'Authorization: Bearer ' . $providerConfig['key'];
        $payload = [
            'model' => $providerConfig['model'],
            'max_tokens' => 1200,
            'temperature' => 0.2,
            'messages' => [
                ['role' => 'system', 'content' => $system],
                ['role' => 'user', 'content' => $userText],
            ],
        ];
    }
    $encoded = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($encoded === false || strlen($encoded) > 50000) {
        throw new InvalidArgumentException('La solicitud excede el tamaño permitido.');
    }
    $curl = curl_init($providerConfig['url']);
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_POSTFIELDS => $encoded,
        CURLOPT_MAXFILESIZE => 200000,
    ]);
    $raw = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    $error = curl_errno($curl);
    curl_close($curl);
    if ($raw === false || $error !== 0 || strlen((string) $raw) > 200000) {
        throw new RuntimeException('El proveedor de IA no respondió dentro de los límites permitidos.');
    }
    $decoded = json_decode((string) $raw, true);
    if (!is_array($decoded)) {
        throw new RuntimeException('El proveedor de IA devolvió una respuesta inválida.');
    }
    if ($status < 200 || $status >= 300) {
        // Do not relay provider error bodies; they may contain sensitive metadata.
        throw new RuntimeException('El proveedor de IA rechazó la solicitud (HTTP ' . $status . ').');
    }
    if ($provider === 'anthropic') {
        $text = '';
        foreach (($decoded['content'] ?? []) as $block) {
            if (is_array($block) && ($block['type'] ?? '') === 'text') $text .= (string) ($block['text'] ?? '');
        }
    } else {
        $text = (string) ($decoded['choices'][0]['message']['content'] ?? '');
    }
    $text = trim($text);
    if ($text === '' || strlen($text) > 100000) {
        throw new RuntimeException('El proveedor de IA devolvió contenido vacío o demasiado extenso.');
    }
    return ['provider' => $provider, 'model' => $providerConfig['model'], 'text' => $text];
}
