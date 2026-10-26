<?php
declare(strict_types=1);

/**
 * Offline tests for the provider router. No API keys, network calls or paid requests.
 * Run: php tests/ai-provider-router.test.php
 */
require_once __DIR__ . '/../api/ai/provider-router.php';

$passed = 0;
$failed = 0;

function check(bool $condition, string $message): void {
    global $passed, $failed;
    if ($condition) {
        $passed++;
        echo "PASS: {$message}\n";
    } else {
        $failed++;
        fwrite(STDERR, "FAIL: {$message}\n");
    }
}

$config = [
    'openai_api_key' => 'test-key-not-real',
    'anthropic_api_key' => 'test-key-not-real',
    'deepseek_api_key' => 'test-key-not-real',
];

foreach (['openai', 'anthropic', 'deepseek'] as $provider) {
    $resolved = declarafy_ai_provider_config($config, $provider);
    check($resolved['key'] === 'test-key-not-real', "{$provider} reads its configured key");
    check(str_starts_with($resolved['url'], 'https://'), "{$provider} uses HTTPS");
    check($resolved['model'] !== '', "{$provider} has a default model");
}

try {
    declarafy_ai_provider_config($config, 'unknown-provider');
    check(false, 'unknown provider is rejected');
} catch (InvalidArgumentException $e) {
    check($e->getMessage() === 'Proveedor de IA no permitido.', 'unknown provider is rejected');
}

try {
    declarafy_ai_provider_config([], 'openai');
    check(false, 'missing key is rejected');
} catch (RuntimeException $e) {
    check($e->getMessage() === 'Proveedor de IA no configurado.', 'missing key is rejected');
}

$custom = declarafy_ai_provider_config([
    'openai_api_key' => 'test-key-not-real',
    'openai_model' => 'approved-test-model',
], 'openai');
check($custom['model'] === 'approved-test-model', 'configured model override is respected');

echo "\nResults: {$passed} passed, {$failed} failed\n";
exit($failed === 0 ? 0 : 1);
