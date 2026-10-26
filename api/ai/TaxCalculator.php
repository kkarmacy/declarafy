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
        // Only the latest user message can authorize the rate for this calculation.
        // An unrelated percentage mentioned earlier must not carry over.
        $latestUserText = null;
        for ($index = count($messages) - 1; $index >= 0; $index--) {
            $message = $messages[$index] ?? null;
            if (is_array($message) && ($message['role'] ?? '') === 'user') {
                $latestUserText = is_string($message['content'] ?? null) ? $message['content'] : '';
                break;
            }
        }
        if ($latestUserText === null || $latestUserText === '') {
            return false;
        }
        // This lightweight provenance check must fail closed for obvious negation
        // or correction language; it cannot safely infer which rate the user intended.
        if (preg_match('/\\b(?:no\\s+(?:uses|utilices|apliques|aplicar|apliques|aplicar|aplica)|en\\s+lugar\\s+de|en\\s+vez\\s+de|sino|correcci[oó]n|mejor\\s+(?:usa|utiliza|aplica))\\b/iu', $latestUserText) === 1) {
            return false;
        }
        preg_match_all('/(?<![\\d.])(\\d{1,3}(?:[.,]\\d+)?)\\s*(?:%|por\\s+ciento)/iu', $latestUserText, $matches);
        $explicitRates = [];
        foreach ($matches[1] ?? [] as $match) {
            $explicitRate = (float) str_replace(',', '.', $match);
            $explicitRates[(string) $explicitRate] = $explicitRate;
        }
        // Fail closed when the latest message mentions multiple different rates.
        // This lightweight check cannot reliably resolve corrections or negation.
        if (count($explicitRates) !== 1) {
            return false;
        }
        $onlyRate = reset($explicitRates);
        return abs($onlyRate - $ratePercent) < 0.000001;
    }

    /**
     * Validate a decoded JSON request body and calculate only after strict type checks.
     * JSON numeric strings are intentionally rejected rather than silently coerced.
     *
     * @return array{taxable_base:float, rate_percent:float, tax_amount:float, total_amount:float, tax_included:bool}
     */
    public static function calculateRequest(array $body): array
    {
        $amount = $body['amount'] ?? null;
        $ratePercent = $body['rate_percent'] ?? null;
        $taxIncluded = $body['tax_included'] ?? false;

        if ((!is_int($amount) && !is_float($amount)) ||
            (!is_int($ratePercent) && !is_float($ratePercent))) {
            throw new InvalidArgumentException('El importe y la tasa deben enviarse como números.');
        }
        if (!is_bool($taxIncluded)) {
            throw new InvalidArgumentException('tax_included debe ser true o false.');
        }

        return self::calculate((float) $amount, (float) $ratePercent, $taxIncluded);
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
