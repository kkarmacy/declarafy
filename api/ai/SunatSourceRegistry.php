<?php
declare(strict_types=1);

/**
 * Allowlisted retrieval of official SUNAT guidance pages.
 * This is retrieval, not a legal applicability engine: callers must inspect
 * the returned page text, retrieval timestamp and effective-period wording.
 */
final class DeclarafySunatSourceRegistry
{
    private const SOURCES = [
        'igv_rate' => [
            'title' => 'SUNAT: Concepto, tasa y operaciones gravadas - IGV',
            'url' => 'https://orientacion.sunat.gob.pe/3053-concepto-tasa-y-operaciones-gravadas-igv-empresas',
        ],
        'igv_calculation' => [
            'title' => 'SUNAT: Cálculo del impuesto IGV',
            'url' => 'https://orientacion.sunat.gob.pe/3109-05-calculo-del-impuesto',
        ],
    ];

    private const MAX_RESPONSE_BYTES = 1_000_000;
    private const MAX_TEXT_CHARS = 15_000;

    /** @var callable(string):array{status:int,content_type:string,body:string}|null */
    private $transport;

    public function __construct(?callable $transport = null)
    {
        $this->transport = $transport;
    }

    /** @return list<array{id:string,title:string,url:string}> */
    public static function listSources(): array
    {
        $items = [];
        foreach (self::SOURCES as $id => $source) {
            $items[] = ['id' => $id, 'title' => $source['title'], 'url' => $source['url']];
        }
        return $items;
    }

    /**
     * Fetch one fixed allowlisted source; arbitrary URLs are never accepted.
     *
     * @return array{id:string,title:string,url:string,retrieved_at_utc:string,sha256:string,text:string}
     */
    public function retrieve(string $id): array
    {
        if (!isset(self::SOURCES[$id])) {
            throw new InvalidArgumentException('La fuente SUNAT solicitada no está autorizada.');
        }

        $source = self::SOURCES[$id];
        $response = $this->transport !== null
            ? ($this->transport)($source['url'])
            : $this->request($source['url']);

        if (!is_array($response)
            || ($response['status'] ?? 0) < 200
            || ($response['status'] ?? 0) >= 300
            || !is_string($response['body'] ?? null)
            || strlen($response['body']) > self::MAX_RESPONSE_BYTES
            || !preg_match('~^text/html\b~i', (string) ($response['content_type'] ?? ''))
        ) {
            throw new RuntimeException('No se pudo recuperar una página HTML oficial de SUNAT de forma segura.');
        }

        // Remove executable/non-content blocks before stripping remaining markup.
        // Resulting text remains untrusted and must never be treated as instructions.
        $html = preg_replace('~<(script|style|noscript|iframe|object)\\b[^>]*>.*?</\\1\\s*>~is', ' ', $response['body']) ?? '';
        $text = html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = preg_replace('/\\s+/u', ' ', $text) ?? '';
        $text = trim($text);
        if ($text === '') {
            throw new RuntimeException('La fuente SUNAT no contiene texto legible.');
        }
        if (mb_strlen($text, 'UTF-8') > self::MAX_TEXT_CHARS) {
            $text = mb_substr($text, 0, self::MAX_TEXT_CHARS, 'UTF-8');
        }

        return [
            'id' => $id,
            'title' => $source['title'],
            'url' => $source['url'],
            'retrieved_at_utc' => gmdate('c'),
            'sha256' => hash('sha256', $response['body']),
            'text' => $text,
        ];
    }

    /** @return array{status:int,content_type:string,body:string} */
    private function request(string $url): array
    {
        $host = parse_url($url, PHP_URL_HOST);
        if (parse_url($url, PHP_URL_SCHEME) !== 'https'
            || !in_array($host, ['orientacion.sunat.gob.pe'], true)
        ) {
            throw new RuntimeException('Destino de fuente no permitido.');
        }
        if (!function_exists('curl_init')) {
            throw new RuntimeException('La extensión cURL no está disponible en el servidor.');
        }

        $body = '';
        $tooLarge = false;
        $curl = curl_init($url);
        if ($curl === false) {
            throw new RuntimeException('No se pudo iniciar la conexión segura con SUNAT.');
        }
        $configured = curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 12,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_MAXFILESIZE => self::MAX_RESPONSE_BYTES,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER => ['Accept: text/html', 'User-Agent: DeclarafySourceReader/1.0'],
            // Enforce the limit while receiving bytes; CURLOPT_MAXFILESIZE alone
            // may not protect responses without a trustworthy Content-Length.
            CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$body, &$tooLarge): int {
                if (strlen($body) + strlen($chunk) > self::MAX_RESPONSE_BYTES) {
                    $tooLarge = true;
                    return 0;
                }
                $body .= $chunk;
                return strlen($chunk);
            },
        ]);
        if (!$configured) {
            curl_close($curl);
            throw new RuntimeException('No se pudo configurar la conexión segura con SUNAT.');
        }

        $ok = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
        $contentType = (string) curl_getinfo($curl, CURLINFO_CONTENT_TYPE);
        $error = curl_error($curl);
        curl_close($curl);

        if ($tooLarge) {
            throw new RuntimeException('La respuesta de SUNAT supera el límite de tamaño permitido.');
        }
        if ($ok !== true) {
            throw new RuntimeException($error !== '' ? $error : 'Falló la recuperación de la fuente SUNAT.');
        }
        return ['status' => $status, 'content_type' => $contentType, 'body' => $body];
    }
}
