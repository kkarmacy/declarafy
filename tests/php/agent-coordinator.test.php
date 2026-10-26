<?php
declare(strict_types=1);

require_once __DIR__ . '/../api/ai/AgentCoordinator.php';

function check(bool $condition, string $message): void {
    if (!$condition) {
        fwrite(STDERR, "FAIL: {$message}\n");
        exit(1);
    }
}

$previous = getenv('DECLARAFY_AI_AGENTS_ENABLED');
putenv('DECLARAFY_AI_AGENTS_ENABLED=false');
check(DeclarafyAgentCoordinator::status()['enabled'] === false, 'feature is disabled by default');

$tax = DeclarafyAgentCoordinator::plan('¿Cuándo vence mi declaración según SUNAT?');
check(in_array('tax', $tax['steps'], true), 'tax workflow routes to tax role');
check(in_array('verifier', $tax['steps'], true), 'workflow includes verifier when within step limit');
check(count($tax['steps']) <= DeclarafyAgentCoordinator::MAX_STEPS, 'workflow is bounded');

$docs = DeclarafyAgentCoordinator::plan('Quiero importar un archivo XML de comprobantes');
check($docs['intent'] === 'document_review', 'document request is classified');

$calc = DeclarafyAgentCoordinator::plan('Calcula el IGV de esta operación');
check($calc['intent'] === 'tax_calculation', 'calculation request is classified');

$thrown = false;
try { DeclarafyAgentCoordinator::plan('   '); } catch (InvalidArgumentException $e) { $thrown = true; }
check($thrown, 'empty input is rejected');

$thrown = false;
try { DeclarafyAgentCoordinator::validateAnswer(str_repeat('x', 20001)); } catch (UnexpectedValueException $e) { $thrown = true; }
check($thrown, 'oversized answer is rejected');

if ($previous === false) putenv('DECLARAFY_AI_AGENTS_ENABLED'); else putenv('DECLARAFY_AI_AGENTS_ENABLED=' . $previous);
echo "OK: Declarafy AI coordinator tests passed\n";
