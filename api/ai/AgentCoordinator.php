<?php
declare(strict_types=1);

/**
 * Declarafy AI coordinator — safe, feature-flagged orchestration primitives.
 *
 * This file deliberately performs no network requests and executes no user-supplied
 * code. Provider adapters and authenticated endpoint wiring are a separate step.
 */
final class DeclarafyAgentCoordinator
{
    public const VERSION = '0.1.0';
    public const MAX_INPUT_CHARS = 12000;
    public const MAX_STEPS = 3;

    /** @return array{enabled:bool,version:string,agents:list<string>,max_steps:int} */
    public static function status(): array
    {
        $enabled = filter_var(getenv('DECLARAFY_AI_AGENTS_ENABLED') ?: 'false', FILTER_VALIDATE_BOOLEAN);
        return [
            'enabled' => $enabled,
            'version' => self::VERSION,
            'agents' => ['tax', 'documents', 'calculator', 'verifier', 'report'],
            'max_steps' => self::MAX_STEPS,
        ];
    }

    /**
     * Select a bounded workflow from a fixed allowlist; never accept agent names
     * from the caller. This is routing metadata, not a claim that an agent ran.
     *
     * @return array{intent:string,steps:list<string>,requires_sources:bool,requires_human_review:bool}
     */
    public static function plan(string $question): array
    {
        $question = trim($question);
        if ($question === '' || mb_strlen($question, 'UTF-8') > self::MAX_INPUT_CHARS) {
            throw new InvalidArgumentException('La consulta está vacía o supera el límite permitido.');
        }

        $text = mb_strtolower($question, 'UTF-8');
        $documents = preg_match('/\b(xlsx|xls|csv|xml|comprobante|factura|archivo|adjunto|importar)\b/u', $text) === 1;
        $calculation = preg_match('/\b(calcula|calcular|cuánto|cuanto|tasa|porcentaje|igv|impuesto|retención|retencion|percepción|percepcion|renta)\b/u', $text) === 1;
        $tax = preg_match('/\b(sunat|tribut|norma|ley|resolución|resolucion|ruc|declaración|declaracion|igv|impuesto|renta|vencimiento)\b/u', $text) === 1;

        $steps = [];
        if ($documents) $steps[] = 'documents';
        if ($tax || (!$documents && !$calculation)) $steps[] = 'tax';
        if ($calculation) $steps[] = 'calculator';
        $steps[] = 'verifier';
        $steps[] = 'report';
        $steps = array_values(array_unique($steps));
        $steps = array_slice($steps, 0, self::MAX_STEPS);

        return [
            'intent' => $documents ? 'document_review' : ($calculation ? 'tax_calculation' : 'tax_question'),
            'steps' => $steps,
            'requires_sources' => $tax || !$calculation,
            'requires_human_review' => true,
        ];
    }

    /** Reject malformed or excessively long model output before display. */
    public static function validateAnswer(string $answer): string
    {
        $answer = trim($answer);
        if ($answer === '' || mb_strlen($answer, 'UTF-8') > 20000) {
            throw new UnexpectedValueException('La respuesta está vacía o supera el límite permitido.');
        }
        return $answer;
    }
}
