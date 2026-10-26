<?php
declare(strict_types=1);

/**
 * Deterministic, provider-free tax arithmetic.
 *
 * The caller must supply the legally applicable rate and whether the entered
 * amount already includes tax. This class does not decide taxability or rates.
 */
final class DeclarafyTaxCalculator
{
    /**
     * Calculate tax for a supplied base amount and explicit rate.
     *
     * @return array{taxable_base:float, rate_percent:float, tax_amount:float, total_amount:float, tax_included:bool}
     */
    public static function calculate(float $amount, float $ratePercent, bool $taxIncluded = false): array
    {
        if (!is_finite($amount) || $amount < 0) {
            throw new InvalidArgumentException('El importe debe ser un número finito no negativo.');
        }
        if (!is_finite($ratePercent) || $ratePercent < 0 || $ratePercent > 100) {
            throw new InvalidArgumentException('La tasa debe estar entre 0 y 100.');
        }

        $rate = $ratePercent / 100;
        if ($taxIncluded) {
            $total = round($amount, 2);
            $base = $rate === 0.0 ? $total : round($total / (1 + $rate), 2);
            $tax = round($total - $base, 2);
        } else {
            $base = round($amount, 2);
            $tax = round($base * $rate, 2);
            $total = round($base + $tax, 2);
        }

        return [
            'taxable_base' => $base,
            'rate_percent' => round($ratePercent, 4),
            'tax_amount' => $tax,
            'total_amount' => $total,
            'tax_included' => $taxIncluded,
        ];
    }
}
