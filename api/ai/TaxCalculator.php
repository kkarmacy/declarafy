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
     * Confirm that a rate appears explicitly in user-authored conversation text.
     * Assistant messages and tool outputs are deliberately not accepted as provenance.
     */
    public static function rateWasExplicitlyProvided(array $messages, float $ratePercent): bool
    {
        if (!is_finite($ratePercent)) {
            return false;
        }
        $userText = [];
        foreach ($messages as $message) {
            if (is_array($message) && ($message['role'] ?? '') === 'user' && is_string($message['content'] ?? null)) {
                $userText[] = $message['content'];
            }
        }
        preg_match_all('/(?<![\\d.])(\\d{1,3}(?:[.,]\\d+)?)\\s*(?:%|por\\s+ciento)/iu', implode("\\n", $userText), $matches);
        foreach ($matches[1] ?? [] as $match) {
            $explicitRate = (float) str_replace(',', '.', $match);
            if (abs($explicitRate - $ratePercent) < 0.000001) {
                return true;
            }
        }
        return false;
    }

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
