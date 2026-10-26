<?php
declare(strict_types=1);

/**
 * Bounded CSV/TXT extraction for AI review. This class never stores files,
 * calls an AI provider, or writes to the database.
 */
final class DeclarafySafeTextFileParser
{
    public const MAX_BYTES = 8 * 1024 * 1024;
    public const MAX_TEXT_CHARS = 12000;
    public const MAX_ROWS = 500;
    public const MAX_COLUMNS = 30;
    public const MAX_CELL_CHARS = 2000;

    /** @return array{format:string,text:string,row_count:int,column_count:int,truncated:bool} */
    public static function parse(string $path, string $extension): array
    {
        $extension = strtolower(ltrim(trim($extension), '.'));
        if (!in_array($extension, ['txt', 'csv'], true)) {
            throw new InvalidArgumentException('Solo se admiten archivos TXT o CSV.');
        }
        if (!is_file($path) || is_link($path) || !is_readable($path)) {
            throw new InvalidArgumentException('El archivo temporal no es válido.');
        }
        $size = filesize($path);
        if ($size === false || $size < 1 || $size > self::MAX_BYTES) {
            throw new InvalidArgumentException('El archivo está vacío o supera el límite de 8 MiB.');
        }

        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mime = $finfo->file($path);
        $allowedMimes = ['text/plain', 'text/csv', 'application/csv', 'application/vnd.ms-excel'];
        if (!is_string($mime) || !in_array($mime, $allowedMimes, true)) {
            throw new InvalidArgumentException('El contenido no es un archivo de texto/CSV admitido.');
        }

        $raw = file_get_contents($path);
        if (!is_string($raw) || !mb_check_encoding($raw, 'UTF-8')) {
            throw new InvalidArgumentException('El archivo debe contener texto UTF-8 válido.');
        }
        if (str_contains($raw, "\0")) {
            throw new InvalidArgumentException('El archivo contiene bytes no admitidos.');
        }

        if ($extension === 'txt') {
            $text = trim(preg_replace("/\\r\\n?/", "\\n", $raw) ?? '');
            if ($text === '') {
                throw new InvalidArgumentException('El archivo no contiene texto.');
            }
            if (mb_strlen($text, 'UTF-8') > self::MAX_TEXT_CHARS) {
                throw new InvalidArgumentException('El texto supera el límite de análisis de 12 000 caracteres.');
            }
            return ['format' => 'txt', 'text' => $text, 'row_count' => substr_count($text, "\n") + 1, 'column_count' => 1, 'truncated' => false];
        }

        // Remove UTF-8 BOM before parsing CSV.
        $raw = preg_replace('/^\\xEF\\xBB\\xBF/', '', $raw) ?? $raw;
        $stream = fopen('php://temp', 'w+b');
        if ($stream === false) {
            throw new RuntimeException('No se pudo preparar la lectura del CSV.');
        }
        try {
            fwrite($stream, $raw);
            rewind($stream);
            $rows = [];
            $maxColumns = 0;
            $totalChars = 0;
            while (($row = fgetcsv($stream, 100000, ',', '"', '')) !== false) {
                if (count($row) > self::MAX_COLUMNS) {
                    throw new InvalidArgumentException('El CSV supera el límite de 30 columnas.');
                }
                if (count($rows) >= self::MAX_ROWS) {
                    throw new InvalidArgumentException('El CSV supera el límite de 500 filas.');
                }
                $cleanRow = [];
                foreach ($row as $cell) {
                    $cell = trim((string) $cell);
                    if (mb_strlen($cell, 'UTF-8') > self::MAX_CELL_CHARS) {
                        throw new InvalidArgumentException('Una celda del CSV supera los 2 000 caracteres.');
                    }
                    $cleanRow[] = $cell;
                    $totalChars += mb_strlen($cell, 'UTF-8');
                }
                $maxColumns = max($maxColumns, count($cleanRow));
                $rows[] = $cleanRow;
                if ($totalChars > self::MAX_TEXT_CHARS) {
                    throw new InvalidArgumentException('El contenido del CSV supera el límite de análisis de 12 000 caracteres.');
                }
            }
            if ($rows === []) {
                throw new InvalidArgumentException('El CSV no contiene filas.');
            }
            $lines = [];
            foreach ($rows as $row) {
                $lines[] = implode(' | ', array_map(
                    static fn(string $cell): string => str_replace(["\r", "\n"], ' ', $cell),
                    $row
                ));
            }
            return ['format' => 'csv', 'text' => implode("\n", $lines), 'row_count' => count($rows), 'column_count' => $maxColumns, 'truncated' => false];
        } finally {
            fclose($stream);
        }
    }
}
