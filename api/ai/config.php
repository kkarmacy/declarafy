<?php
declare(strict_types=1);

function declarafy_ai_config(): array {
    $baseUrl = getenv('LITELLM_BASE_URL') ?: '';
    $apiKey = getenv('LITELLM_API_KEY') ?: '';
    $model = getenv('LITELLM_MODEL') ?: 'declarafy-tax';

    return [
        'base_url' => rtrim($baseUrl, '/'),
        'api_key' => $apiKey,
        'model' => $model,
        'timeout' => 45,
        'max_input_chars' => 12000,
    ];
}
