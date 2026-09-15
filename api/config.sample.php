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
    'openai_api_key' => '',
    'deepseek_api_key' => '',
    'sunat_api_url' => '',
    'sunat_api_token' => '',
    // API oficial SUNAT: Consulta Integrada de Validez de CPE.
    // Genere estas credenciales en SOL > Credenciales de API SUNAT.
    'sunat_client_id' => '',
    'sunat_client_secret' => '',
    'sunat_query_ruc' => '',
    'culqi_private_key' => '',
    'mail_from' => 'no-reply@declarafy.com',
];
