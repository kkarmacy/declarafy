<?php
// Copy this file to config.local.php on the server and replace the values.
// config.local.php is ignored by Git and blocked from web access.
return [
    'db_host' => 'localhost',
    'db_port' => 3306,
    'db_name' => 'CPANELUSER_declarafy',
    'db_user' => 'CPANELUSER_declarafy',
    'db_password' => 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD',
    'app_origin' => 'https://declarafy.com',
    'admin_email' => 'christian@declarafy.com',
    'anthropic_api_key' => '',
    // OpenHarness must run in a separate isolated service. Keep disabled until ready.
    'openharness_enabled' => '0',
    'openharness_url' => '',
    'openharness_token' => '',
    'openai_api_key' => '',
    'deepseek_api_key' => '',
    'sunat_api_url' => '',
    'sunat_api_token' => '',
    // API oficial SUNAT: Consulta Integrada de Validez de CPE.
    // Genere estas credenciales en SOL > Credenciales de API SUNAT.
    'sunat_client_id' => '',
    'sunat_client_secret' => '',
    'sunat_query_ruc' => '',
    // OAuth SUNAT para servicios que requieren Clave SOL (mantener solo en config.local.php).
    'sunat_sol_username' => '', // usuario SOL, sin el RUC
    'sunat_sol_password' => '', // Clave SOL; nunca subirla a GitHub
    // El scope OAuth se selecciona en api/index.php según el servicio elegido; no añadirlo aquí.
    'culqi_private_key' => '',
    'mail_from' => 'no-reply@declarafy.com',
];
