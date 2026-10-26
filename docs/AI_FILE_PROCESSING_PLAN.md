# Declarafy secure file-processing plan (cPanel-first)

**Status:** design only; no upload endpoint or file parser is enabled by this document. This plan is on `feat/ai-agent-coordinator-v1` and is not deployed.

## Goal

Add authenticated file analysis for tax-support documents without requiring Python on the user's PC, a separate server, or a new paid service. Keep the current production app unchanged until the implementation has tests and is explicitly approved.

## Phase 1 — safe intake (PHP on Namecheap/cPanel)

1. Add a dedicated `POST action=ai_file_analyze` endpoint; require a valid logged-in session, CSRF protection consistent with existing write endpoints, and a per-user/IP rate limit.
2. Accept one file per request. Initial limits: 8 MiB maximum, 1 file, bounded request time. Enforce both PHP upload error codes and server-side size checks.
3. Allow only a documented extension/MIME pair; never trust the browser-provided filename or Content-Type. Inspect content with PHP Fileinfo (`finfo`) and reject mismatches.
4. Move the uploaded file to a generated random name in a non-public temporary/quarantine directory. Never store uploads in `public_html`, never use the original filename as a path, and never execute or render uploaded content directly.
5. Do not accept archives/ZIP files in the first version. They introduce decompression-bomb and nested-file risks.
6. Clean up temporary files in a `finally` path after parsing/provider use, including error cases. Do not log file contents, tax IDs, or extracted personal data.

## Phase 2 — parsers and deterministic preview

Start with **CSV and plain text** only, subject to checking that the required PHP extensions are present. Validate encoding, cap rows/columns/cell length, reject malformed input, and return a preview before any import or database write.

Add XML only after implementing safe XML parsing with external entity/network resolution disabled. PDF, DOC/DOCX and XLS/XLSX must remain unsupported until the server's available libraries, licensing, file size behavior, and parser security are verified. File extension recognition alone is not file processing.

## Phase 3 — AI-assisted review

- Extract only bounded text from validated parser output; never send raw file bytes to the model unless the provider and API format explicitly support that flow.
- Label extracted text as untrusted document data and instruct the model to ignore instructions embedded in uploaded files.
- Use the existing server-side provider key; never expose provider keys to the browser. If the key is absent, return the existing clear `ai/not-configured` error.
- Return structured findings with page/row references when available, uncertainties, and a human-review warning. Do not automatically submit tax declarations, edit accounting records, or import results without explicit confirmation.

## Required tests before enabling

- unauthenticated request, invalid CSRF token, rate limit, oversize file, upload error, MIME/extension mismatch, empty file, malformed CSV, huge row/cell count, traversal filename, and cleanup on parser/provider failure;
- malicious XML with external entities (must not access network/filesystem), prompt-injection text in a document, and invalid UTF-8;
- verify uploaded files are never web-accessible and no file contents or credentials enter logs;
- integration smoke test in a staging directory on cPanel, using a test account and a non-sensitive sample file.

## Release gates

1. Confirm cPanel PHP version, Fileinfo availability, writable private temp location, upload limits, and available parser libraries.
2. Implement intake and CSV/TXT preview behind a disabled feature flag.
3. Pass automated tests and manual staging checks.
4. Only then consider adding PDF/Office formats.
5. Keep production disabled until the user explicitly approves deployment.

## Current limitations

This is a plan, not an implementation. The current coordinator's `documents` role is routing metadata only; it does not receive uploads, parse files, or independently run as an agent. The coordinator PR also does not install HKUDS/OpenHarness.