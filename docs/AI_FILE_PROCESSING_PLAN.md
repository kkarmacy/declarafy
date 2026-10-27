# Declarafy secure file-processing plan (cPanel-first)

**Status (branch only, 2026-10-26):** the CSV/TXT parser, authenticated `POST action=ai_file_analyze` endpoint, and frontend button/request flow are implemented on `feat/ai-agent-coordinator-v1`. GitHub Actions browser, PHP coordinator, and security checks pass for the current commit. This is not a live cPanel integration test: server upload limits, provider-key configuration, quota behavior under real requests, and abuse-case coverage remain unverified. The branch is not deployed and is not production-ready.

## Goal

Add authenticated file analysis for tax-support documents without requiring Python on the user's PC, a separate server, or a new paid service. Keep the current production app unchanged until the implementation has tests and is explicitly approved.

## Phase 1 — safe intake (PHP on Namecheap/cPanel)

1. Implemented on the branch: `POST action=ai_file_analyze` requires a logged-in session, the existing write-endpoint CSRF/header checks, and a rate limit of 10 attempts per hour per IP/action bucket. Additional per-user upload limits and abuse tests remain to be added.
2. Implemented on the branch: one uploaded file is required by the endpoint; the UI currently permits choosing multiple attachments but refuses to analyze unless exactly one is selected. The parser enforces an 8 MiB limit, PHP upload errors are checked, and the provider timeout is 90 seconds. The hosting PHP `upload_max_filesize`/`post_max_size` settings still need confirmation.
3. Implemented for CSV/TXT: extension allowlist and PHP Fileinfo MIME allowlist are checked. The original filename is used only as sanitized metadata, not as a filesystem path.
4. Current implementation parses PHP's request-scoped uploaded temporary file in place and does not persist it or move it into `public_html`. A dedicated private quarantine directory is not yet implemented; confirm PHP temporary-directory permissions on cPanel before enabling.
5. Do not accept archives/ZIP files in the first version. They introduce decompression-bomb and nested-file risks.
6. The application does not create persistent copies; PHP manages its upload temporary file. A dedicated application-owned temporary-file cleanup path is therefore not yet applicable. Error logs record exception class/status context, not extracted document text.

## Phase 2 — parsers and deterministic preview

Implemented on the branch: **CSV and plain text** parsing with UTF-8 validation and caps (8 MiB, 500 rows, 30 columns, 2,000 characters per cell, 12,000 extracted characters). The endpoint sends the extracted text to the configured AI provider and returns findings; it does not import or write document data to the database. A separate preview-first UI has not yet been implemented.

Add XML only after implementing safe XML parsing with external entity/network resolution disabled. PDF, DOC/DOCX and XLS/XLSX must remain unsupported until the server's available libraries, licensing, file size behavior, and parser security are verified. File extension recognition alone is not file processing.

## Phase 3 — AI-assisted review

- Extract only bounded text from validated parser output; never send raw file bytes to the model unless the provider and API format explicitly support that flow.
- Label extracted text as untrusted document data and instruct the model to ignore instructions embedded in uploaded files.
- Use the existing server-side provider key; never expose provider keys to the browser. If the key is absent, return the existing clear `ai/not-configured` error.
- Return structured findings with page/row references when available, uncertainties, and a human-review warning. Do not automatically submit tax declarations, edit accounting records, or import results without explicit confirmation.

## Required tests before enabling

Automated CI currently passes its browser, PHP coordinator, and security workflows. The frontend regression test confirms the upload control is wired after UI initialization. The following targeted abuse/integration tests are still required:

- unauthenticated request, invalid CSRF token, rate limit, oversize file, upload error, MIME/extension mismatch, empty file, malformed CSV, huge row/cell count, traversal filename, and cleanup on parser/provider failure;
- malicious XML with external entities (must not access network/filesystem), prompt-injection text in a document, and invalid UTF-8;
- verify uploaded files are never web-accessible and no file contents or credentials enter logs;
- integration smoke test in a staging directory on cPanel, using a test account and a non-sensitive sample file.

## Release gates

1. Confirm cPanel PHP version, Fileinfo availability, writable private temp location, upload limits, and available parser libraries.
2. Complete abuse-case tests and validate the intake flow on cPanel staging with a non-sensitive sample CSV/TXT; the current branch UI submits the selected file for analysis directly and does not yet provide a separate preview-first step.
3. Pass automated tests and manual staging checks.
4. Only then consider adding PDF/Office formats.
5. Keep production disabled until the user explicitly approves deployment.

## Current limitations

The branch now contains an initial CSV/TXT parser, authenticated AI analysis endpoint, and frontend control, but no cPanel end-to-end validation. It is not deployed. The current coordinator's `documents` role remains routing metadata; it does not independently run as an agent. The coordinator PR also does not install HKUDS/OpenHarness.