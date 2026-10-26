<?php
declare(strict_types=1);

require_once __DIR__ . '/../../api/ai/SafeTextFileParser.php';

function parserCheck(bool $condition, string $message): void {
    if (!$condition) {
        fwrite(STDERR, "FAIL: {$message}\n");
        exit(1);
    }
}
function parserRejects(callable $fn, string $message): void {
    try { $fn(); } catch (InvalidArgumentException) { return; }
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}
function tempFixture(string $content): string {
    $path = tempnam(sys_get_temp_dir(), 'declarafy-test-');
    if ($path === false || file_put_contents($path, $content) === false) {
        throw new RuntimeException('Could not create parser fixture');
    }
    return $path;
}

$txt = tempFixture("SUNAT\nIGV 18%\n");
try {
    $result = DeclarafySafeTextFileParser::parse($txt, 'txt');
    parserCheck($result['format'] === 'txt', 'TXT format recognized');
    parserCheck(str_contains($result['text'], 'IGV 18%'), 'TXT text extracted');
    parserCheck($result['row_count'] === 2, 'TXT line count reported');
} finally { unlink($txt); }

$csv = tempFixture("\xEF\xBB\xBFfecha,monto\n2026-10-01,118.00\n");
try {
    $result = DeclarafySafeTextFileParser::parse($csv, '.csv');
    parserCheck($result['format'] === 'csv', 'CSV format recognized');
    parserCheck($result['row_count'] === 2, 'CSV row count reported');
    parserCheck($result['column_count'] === 2, 'CSV column count reported');
    parserCheck(str_contains($result['text'], '118.00'), 'CSV values extracted');
} finally { unlink($csv); }

$empty = tempFixture('');
parserRejects(fn() => DeclarafySafeTextFileParser::parse($empty, 'txt'), 'empty file rejected');
unlink($empty);

$badExtension = tempFixture('some text');
parserRejects(fn() => DeclarafySafeTextFileParser::parse($badExtension, 'pdf'), 'unsupported extension rejected');
unlink($badExtension);

$badEncoding = tempFixture("\xFF\xFE\x00\x00");
parserRejects(fn() => DeclarafySafeTextFileParser::parse($badEncoding, 'txt'), 'invalid UTF-8 rejected');
unlink($badEncoding);

$tooManyColumns = tempFixture(implode(',', array_fill(0, 31, 'x')) . "\n");
parserRejects(fn() => DeclarafySafeTextFileParser::parse($tooManyColumns, 'csv'), 'too many columns rejected');
unlink($tooManyColumns);

$tooLongCell = tempFixture(str_repeat('a', DeclarafySafeTextFileParser::MAX_CELL_CHARS + 1));
parserRejects(fn() => DeclarafySafeTextFileParser::parse($tooLongCell, 'csv'), 'oversized CSV cell rejected');
unlink($tooLongCell);

$tooMuchText = tempFixture(str_repeat('a', DeclarafySafeTextFileParser::MAX_TEXT_CHARS + 1));
parserRejects(fn() => DeclarafySafeTextFileParser::parse($tooMuchText, 'txt'), 'oversized TXT rejected');
unlink($tooMuchText);

echo "OK: Declarafy safe text file parser tests passed\n";
