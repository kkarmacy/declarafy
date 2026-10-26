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

$requestCalc = DeclarafyTaxCalculator::calculateRequest(['amount' => 100, 'rate_percent' => 18]);
expectSame(18.0, $requestCalc['tax_amount'], 'request validator calculates valid numeric JSON fields');
$requestInclusive = DeclarafyTaxCalculator::calculateRequest(['amount' => 118, 'rate_percent' => 18, 'tax_included' => true]);
expectSame(100.0, $requestInclusive['taxable_base'], 'request validator accepts boolean tax_included');
expectInvalid(fn() => DeclarafyTaxCalculator::calculateRequest(['amount' => '100', 'rate_percent' => 18]), 'numeric strings rejected for amount');
expectInvalid(fn() => DeclarafyTaxCalculator::calculateRequest(['amount' => 100, 'rate_percent' => '18']), 'numeric strings rejected for rate');
expectInvalid(fn() => DeclarafyTaxCalculator::calculateRequest(['amount' => 100, 'rate_percent' => 18, 'tax_included' => 'false']), 'string tax_included rejected');
expectInvalid(fn() => DeclarafyTaxCalculator::calculateRequest(['amount' => 100]), 'missing rate rejected');


$rateMessages = [
    ['role' => 'user', 'content' => 'Calcula el impuesto con una tasa de 18%.'],
    ['role' => 'assistant', 'content' => 'La tasa es 18%.'],
];
expectSame(true, DeclarafyTaxCalculator::rateWasExplicitlyProvided($rateMessages, 18.0), 'accepts a rate explicitly written by the user');
expectSame(false, DeclarafyTaxCalculator::rateWasExplicitlyProvided([
    ['role' => 'assistant', 'content' => 'La tasa es 18%.'],
], 18.0), 'does not treat assistant text as user-supplied rate provenance');
expectSame(false, DeclarafyTaxCalculator::rateWasExplicitlyProvided([
    ['role' => 'user', 'content' => 'Calcula el impuesto.'],
], 18.0), 'rejects a rate absent from user messages');
expectSame(false, DeclarafyTaxCalculator::rateWasExplicitlyProvided([
    ['role' => 'user', 'content' => 'Aplica una tasa de 8%.'],
], 18.0), 'rejects a rate that does not match the user-provided rate');
expectSame(false, DeclarafyTaxCalculator::rateWasExplicitlyProvided([
    ['role' => 'user', 'content' => 'No uses 18%; para este cálculo usa 8%.'],
], 18.0), 'rejects ambiguous messages that mention multiple rates');
expectSame(false, DeclarafyTaxCalculator::rateWasExplicitlyProvided([
    ['role' => 'user', 'content' => 'No uses una tasa de 18%.'],
], 18.0), 'rejects an explicitly negated rate even when it is the only percentage');
expectSame(false, DeclarafyTaxCalculator::rateWasExplicitlyProvided([
    ['role' => 'user', 'content' => 'No aplicar 18% a esta operación.'],
], 18.0), 'rejects a Spanish infinitive negation');
expectSame(false, DeclarafyTaxCalculator::rateWasExplicitlyProvided([
    ['role' => 'user', 'content' => "Don't use 18% for this calculation."],
], 18.0), 'rejects a basic English negation');
expectSame(false, DeclarafyTaxCalculator::rateWasExplicitlyProvided([
    ['role' => 'user', 'content' => 'Antes mencioné 18% para otro caso.'],
    ['role' => 'assistant', 'content' => 'Entendido.'],
    ['role' => 'user', 'content' => 'Ahora calcula el impuesto de esta operación.'],
], 18.0), 'does not reuse a rate from an earlier user message');

echo "OK: Declarafy tax calculator tests passed\n";
