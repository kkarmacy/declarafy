<?php
declare(strict_types=1);

require_once __DIR__ . '/../../api/ai/TaxCalculator.php';

function expectSame(mixed $expected, mixed $actual, string $label): void
{
    if ($expected !== $actual) {
        fwrite(STDERR, "FAIL: {$label}; expected " . var_export($expected, true) . ', got ' . var_export($actual, true) . "\n");
        exit(1);
    }
}

function expectInvalid(callable $callback, string $label): void
{
    try {
        $callback();
    } catch (InvalidArgumentException) {
        return;
    }
    fwrite(STDERR, "FAIL: {$label}; expected InvalidArgumentException\n");
    exit(1);
}

$exclusive = DeclarafyTaxCalculator::calculate(100, 18);
expectSame(100.0, $exclusive['taxable_base'], 'tax-exclusive base');
expectSame(18.0, $exclusive['tax_amount'], 'tax-exclusive tax');
expectSame(118.0, $exclusive['total_amount'], 'tax-exclusive total');
expectSame(false, $exclusive['tax_included'], 'tax-exclusive flag');

$inclusive = DeclarafyTaxCalculator::calculate(118, 18, true);
expectSame(100.0, $inclusive['taxable_base'], 'tax-inclusive base');
expectSame(18.0, $inclusive['tax_amount'], 'tax-inclusive tax');
expectSame(118.0, $inclusive['total_amount'], 'tax-inclusive total');

$zeroRate = DeclarafyTaxCalculator::calculate(12.345, 0, true);
expectSame(12.35, $zeroRate['taxable_base'], 'zero-rate inclusive base');
expectSame(0.0, $zeroRate['tax_amount'], 'zero-rate tax');
expectSame(12.35, $zeroRate['total_amount'], 'zero-rate total');

$rounded = DeclarafyTaxCalculator::calculate(10.05, 18);
expectSame(1.81, $rounded['tax_amount'], 'tax rounded to cents');
expectSame(11.86, $rounded['total_amount'], 'total rounded to cents');

expectInvalid(fn() => DeclarafyTaxCalculator::calculate(-1, 18), 'negative amount rejected');
expectInvalid(fn() => DeclarafyTaxCalculator::calculate(NAN, 18), 'NaN amount rejected');
expectInvalid(fn() => DeclarafyTaxCalculator::calculate(INF, 18), 'infinite amount rejected');
expectInvalid(fn() => DeclarafyTaxCalculator::calculate(100, -0.01), 'negative rate rejected');
expectInvalid(fn() => DeclarafyTaxCalculator::calculate(100, 100.01), 'rate above 100 rejected');
expectInvalid(fn() => DeclarafyTaxCalculator::calculate(100, NAN), 'NaN rate rejected');

echo "OK: Declarafy tax calculator tests passed\n";
