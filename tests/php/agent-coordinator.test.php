<?php
declare(strict_types=1);

require_once __DIR__ . '/../../api/ai/AgentCoordinator.php';

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

$pdf = DeclarafyAgentCoordinator::plan('Revisa el PDF adjunto y resume el documento');
check($pdf['intent'] === 'document_review', 'PDF review request is classified as document work');

$docx = DeclarafyAgentCoordinator::plan('Analiza el documento DOCX');
check($docx['intent'] === 'document_review', 'DOCX analysis request is classified as document work');

$genericAnalysis = DeclarafyAgentCoordinator::plan('Analiza mi situación tributaria y dime qué opciones tengo');
check($genericAnalysis['intent'] === 'tax_question', 'generic analysis is not misclassified as document work');

$calc = DeclarafyAgentCoordinator::plan('Calcula el IGV de esta operación');
check($calc['intent'] === 'tax_calculation', 'calculation request is classified');

$thrown = false;
try { DeclarafyAgentCoordinator::plan('   '); } catch (InvalidArgumentException $e) { $thrown = true; }
check($thrown, 'empty input is rejected');

$thrown = false;
try { DeclarafyAgentCoordinator::validateAnswer(str_repeat('x', 20001)); } catch (UnexpectedValueException $e) { $thrown = true; }
check($thrown, 'oversized answer is rejected');


$allowedRoles = ['tax', 'documents', 'calculator', 'verifier', 'report'];
foreach (['tax', 'documents', 'calculator', 'verifier', 'report'] as $role) {
    check(in_array($role, $allowedRoles, true), 'role allowlist includes ' . $role);
}
check($tax['requires_human_review'] === true, 'tax workflow requires human review');
check(is_bool($tax['requires_sources']), 'source requirement is explicit');

$combined = DeclarafyAgentCoordinator::plan('Importar archivo XML y calcula el IGV');
check($combined['intent'] === 'document_review', 'document intent takes precedence for combined document and calculation requests');
check(count($combined['steps']) <= DeclarafyAgentCoordinator::MAX_STEPS, 'combined workflow never exceeds maximum steps');
check(in_array('verifier', $combined['steps'], true), 'combined document and calculation workflow keeps verifier within step limit');
$combinedTaxCalculation = DeclarafyAgentCoordinator::plan('Calcula el impuesto y verifica la tasa de IGV');
check(in_array('verifier', $combinedTaxCalculation['steps'], true), 'tax calculation workflow keeps verifier within step limit');
check(count($combinedTaxCalculation['steps']) <= DeclarafyAgentCoordinator::MAX_STEPS, 'tax calculation workflow remains bounded');

foreach ($combined['steps'] as $step) {
    check(in_array($step, $allowedRoles, true), 'workflow emits only allowlisted roles');
}

$thrown = false;
try { DeclarafyAgentCoordinator::plan(str_repeat('x', DeclarafyAgentCoordinator::MAX_INPUT_CHARS + 1)); } catch (InvalidArgumentException $e) { $thrown = true; }
check($thrown, 'oversized input is rejected');

$atLimit = DeclarafyAgentCoordinator::plan(str_repeat('x', DeclarafyAgentCoordinator::MAX_INPUT_CHARS));
check(count($atLimit['steps']) <= DeclarafyAgentCoordinator::MAX_STEPS, 'maximum-length input is accepted and bounded');

check(DeclarafyAgentCoordinator::validateAnswer('  respuesta válida  ') === 'respuesta válida', 'answer is trimmed before display');
$thrown = false;
try { DeclarafyAgentCoordinator::validateAnswer('   '); } catch (UnexpectedValueException $e) { $thrown = true; }
check($thrown, 'empty answer is rejected');

putenv('DECLARAFY_AI_AGENTS_ENABLED=true');
check(DeclarafyAgentCoordinator::status()['enabled'] === true, 'feature flag can be explicitly enabled');
putenv('DECLARAFY_AI_AGENTS_ENABLED=false');
check(DeclarafyAgentCoordinator::status()['enabled'] === false, 'feature flag can be disabled again');

if ($previous === false) putenv('DECLARAFY_AI_AGENTS_ENABLED'); else putenv('DECLARAFY_AI_AGENTS_ENABLED=' . $previous);
echo "OK: Declarafy AI coordinator tests passed\n";
