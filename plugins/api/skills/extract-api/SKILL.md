---
name: extract-api
description: This skill should be used when the user asks to "extract API from", "import API from", "add commands from this repo", "register API from docs", "convert docs to CLI commands", "import Postman collection", or provides a GitHub repository URL, a documentation site URL, a Postman collection file/URL, or a local API documentation file and wants it imported as sdkck CLI commands.
model: sonnet
context: fork
agent: general-purpose
argument-hint: <github-url|docs-url|file-path> [--name <name>]
allowed-tools: WebFetch, Read, Write, Agent, Bash(sdkck:*), Bash(gh:*), Bash(curl:*), Bash(jq:*), Bash(node:*), Bash(npm:*), Bash(python3:*)
---

Extract API endpoints from any source and import them into sdkck as executable CLI commands.

## Overview

This skill reads API documentation from three source types:

- **GitHub repositories** (public): scans for OpenAPI specs, Postman collections, README, and docs files
- **HTTP/HTTPS documentation URLs**: fetches single or multi-page doc sites; probes for spec/collection files
- **Local files**: reads OpenAPI JSON/YAML, Postman collections, markdown, HTML, or plain text

When an existing OpenAPI spec or Postman collection is found it is used directly — no extraction needed. Otherwise, API endpoints are extracted from the documentation and an OpenAPI 3.0 JSON document is generated. Either way, the result is imported via `sdkck api import`.

## Usage

```
/extract <source> [--name <name>]
```

<!-- prettier-ignore -->
| Argument | Description |
|----------|-------------|
| `<source>` | GitHub URL, HTTP/HTTPS URL, or local file path |
| `--name` | Override the API name (default: derived from source) |

**Examples:**

```bash
/extract https://petstore3.swagger.io/api/v3/openapi.json --name petstore
/extract https://github.com/stripe/openapi --name stripe
/extract https://developers.notion.com/reference/intro
/extract https://docs.github.com/en/rest --name github
/extract ./my-workspace.postman_collection.json --name myapi
/extract ./my-project/api-docs.md --name myapi
```

## Workflow

### Step 1 — Parse arguments

Extract from the user's input:

- `SOURCE`: the GitHub URL, HTTP URL, or file path
- `NAME`: value of `--name` if provided; otherwise derive from the source:
  - GitHub URL → repository name (e.g. `stripe-openapi`)
  - HTTP URL → domain slug (e.g. `docs-github-com`)
  - Local file → filename without extension

Sanitize `NAME`: lowercase letters and hyphens only — replace spaces and special characters with `-`.

### Step 2 — Look for an existing spec or Postman collection (fast path)

Before extracting anything, check whether the source already provides a ready-made OpenAPI/Swagger document or a Postman collection. Either can be passed directly to `sdkck api import` without any extraction.

**Identifying file types:**

- **OpenAPI/Swagger spec**: JSON or YAML with an `openapi` or `swagger` root field → write to `/tmp/openapi-<NAME>.json` and skip to Step 4.
- **Postman collection**: JSON with `info.schema` containing `getpostman.com` (e.g. `https://schema.getpostman.com/json/collection/v2.1.0/collection.json`) → write to `/tmp/postman-<NAME>.json` and skip to Step 4. Postman files bypass the validation hook and are imported as-is.

---

**GitHub URL** (`github.com/<owner>/<repo>`):

1. Extract `owner` and `repo` from the URL.
2. **Detect generated SDK repos first.** Check the repo root for any of these signals:
   - Files named `OPENAPI_VERSION`, `CODEGEN_VERSION`, `SWAGGER_VERSION`, or `.openapi-generator-ignore`
   - A `src/resources/` or `lib/resources/` directory (common in auto-generated SDKs)
   - README text containing phrases like "generated from", "auto-generated", "based on the Stripe OpenAPI spec", etc.
     If any signal is present, the repo is a **generated SDK** — its API spec lives elsewhere. Apply the companion spec heuristics:
   - **Naming pattern**: try `github.com/<owner>/openapi`, `github.com/<owner>/api-spec`, `github.com/<owner>/openapi-spec`, `github.com/<owner>/<repo-without-lang-suffix>` (e.g. `stripe-node` → try `stripe/openapi`). Check if those repos exist and contain a spec file.
   - **README links**: scan the README for any link pointing to a spec URL or a companion repo. Follow the first one that looks like an OpenAPI/Swagger source.
   - If a companion spec is found → **fetch it, write to the appropriate `/tmp/` path, and skip to Step 4.** Report to the user that the spec came from the companion repo, not the SDK repo.
   - If no companion spec can be found → inform the user that this is a generated SDK and suggest providing the spec repo or docs URL directly. Then continue to step 3 to do best-effort extraction from the SDK source.
3. Probe the repo root and common subdirectories (`docs/`, `spec/`, `api/`, `postman/`) for spec/collection files:
   - OpenAPI candidates: `openapi.json`, `openapi.yaml`, `openapi.yml`, `swagger.json`, `swagger.yaml`, `swagger.yml`, `api.json`, `api.yaml`
   - Postman candidates: `*.postman_collection.json`, `postman_collection.json`, `collection.json`
   - For each candidate, fetch raw content and identify its type. If confirmed → **write to the appropriate `/tmp/` path and skip to Step 4.**
4. No spec or collection found — fall back to content collection:
   - Fetch the README: `https://raw.githubusercontent.com/<owner>/<repo>/HEAD/README.md`
   - Check for a `docs/` directory: `GET https://api.github.com/repos/<owner>/<repo>/contents/docs` — if it exists, fetch up to 5 `.md` files from it.
   - Collect all text content and continue to Step 3.

---

**HTTP/HTTPS URL** (non-GitHub):

1. If the URL itself looks like a spec or collection (path ends with `.json`/`.yaml`/`.yml`, or contains `openapi`/`swagger`/`postman`/`api-docs` in the path), fetch it directly and identify its type. If confirmed → **write to the appropriate `/tmp/` path and skip to Step 4.**
2. Derive the base URL (`<scheme>://<host>`) and probe well-known paths with WebFetch (stop at the first valid match):
   - OpenAPI: `/openapi.json`, `/openapi.yaml`, `/swagger.json`, `/swagger.yaml`, `/api-docs.json`, `/api-docs`, `/api/openapi.json`, `/api/swagger.json`, `/v1/openapi.json`, `/v2/openapi.json`
   - Postman: `/postman.json`, `/collection.json`, `/postman_collection.json`
   - If found → **write to the appropriate `/tmp/` path and skip to Step 4.**
3. Fetch the original page. Scan its links for URLs that reference a spec or collection: paths containing `openapi`, `swagger`, `postman`, `api-spec`, `api-docs`, `schema`, or ending in `.json`/`.yaml`. Fetch the first such link and identify its type. If confirmed → **write to the appropriate `/tmp/` path and skip to Step 4.**
4. No spec or collection found — fall back to content collection:
   - Count internal links on the same domain whose paths contain `/api/`, `/reference/`, `/endpoint`, `/resource/`, `/operation/`, `/v1/`, `/v2/`, `/methods/`, `/routes/`.
   - If 2 or more such links, spawn the `web-crawler` agent:
     ```
     Crawl the API documentation site starting at <URL>. Follow links to pages containing API endpoint information (HTTP methods, URL paths, request/response parameters). Collect all documentation text. Return a single aggregated text block with all discovered API documentation.
     ```
   - Otherwise use the fetched page content directly.
   - Continue to Step 3.

---

**Local file path**:

1. Read the file with the Read tool. Supported formats: `.md`, `.mdx`, `.html`, `.txt`, `.json`, `.yaml`, `.yml`
2. If the file is `.json`/`.yaml`/`.yml`:
   - Contains `openapi` or `swagger` root field → **write to `/tmp/openapi-<NAME>.json` and skip to Step 4.**
   - Contains `info.schema` with `getpostman.com` → **write to `/tmp/postman-<NAME>.json` and skip to Step 4.**
3. No spec or collection — continue to Step 3 for extraction.

### Step 3 — Extract API endpoints

Analyze the collected documentation and identify every API operation. For each operation extract:

<!-- prettier-ignore -->
| Field | Description |
|-------|-------------|
| HTTP method | GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS |
| Path | URL path with parameters in `{braces}`, e.g. `/users/{userId}` |
| Operation ID | camelCase unique identifier; derive from method + path if not stated |
| Summary | One-line description |
| Tags | Resource group name (e.g. `users`, `auth`, `orders`) |
| Path parameters | Name, type (default `string`), description; always `required: true` |
| Query parameters | Name, type, description, required flag |
| Request body | JSON Schema object for POST/PUT/PATCH bodies |
| Responses | At minimum `"200": {"description": "Success"}`; add other codes if documented |

Focus only on HTTP API endpoints. Ignore installation guides, changelogs, and non-API content.

### Step 4 — Generate OpenAPI JSON

Build a complete OpenAPI document. Extract the base server URL from the documentation (fall back to `https://api.example.com` if not found).

Mandatory rules:

- `openapi` field must be `"3.0.x"` or `"3.1.x"` (both supported by sdkck); use `"3.0.3"` when generating from scratch
- Every operation must have a non-empty `responses` object
- Path parameters must be listed in the `parameters` array with `"in": "path"` and `"required": true`
- No `$ref` — inline all schemas
- All `operationId` values must be unique across the document
- `info.title` = `NAME`, `info.version` = `"1.0.0"`

Write the completed document to `/tmp/openapi-<NAME>.json`.

### Step 5 — Validation (automatic, OpenAPI only)

If the file written is `/tmp/openapi-<NAME>.json`, the PostToolUse hook validates it automatically. If validation fails, the hook reports specific errors — fix each issue and rewrite the file until the hook reports validation passed.

Postman collections written to `/tmp/postman-<NAME>.json` bypass the hook and are imported as-is; sdkck handles the Postman → OpenAPI conversion internally.

### Step 6 — Import into sdkck

Run the appropriate command based on which file was produced:

```bash
# OpenAPI spec (generated or found)
sdkck api import /tmp/openapi-{NAME}.json --name {NAME}

# Postman collection (found directly)
sdkck api import /tmp/postman-{NAME}.json --name {NAME}
```

Report the result. On success, show:

- API name registered
- Count of operations imported
- Two or three example commands the user can run immediately
- How to explore: `sdkck help {NAME}`

### Step 7 — Configure authentication

After a successful import, check the spec for authentication requirements and guide the user.

**Detect auth type from the spec:**

- `securitySchemes` with `type: http, scheme: bearer` or `type: apiKey` in the header → bearer token
- `securitySchemes` with `type: apiKey` (in query or header) → API key
- `securitySchemes` with `type: http, scheme: basic` → basic auth
- `securitySchemes` with `type: oauth2` → custom header (OAuth2 tokens are bearer tokens in practice)
- No security defined → mention auth is not required but can be added later

**Run the matching command and show it to the user:**

```bash
# Bearer token (most REST APIs, Stripe, GitHub, etc.)
sdkck api auth {NAME} --type bearer --token {your-token}

# API key in a header
sdkck api auth {NAME} --type apikey --api-key {your-key}
sdkck api auth {NAME} --type apikey --api-key {your-key} --api-key-header X-API-Key

# Basic auth
sdkck api auth {NAME} --type basic --username {user} --password {password}

# Custom headers (OAuth2, multi-header, or non-standard schemes)
sdkck api auth {NAME} --type custom --header Authorization="Bearer {token}" --header X-Tenant-ID={tenant}

# View current auth settings
sdkck api auth {NAME} --show

# Remove auth
sdkck api auth {NAME} --type none
```

Show the user the exact command for their API — pre-fill the `--api-key-header` name if it is specified in the spec's `securitySchemes`. If the token value is not known, use a placeholder like `{your-token}` and tell the user where to obtain it (e.g. the API's developer portal or dashboard).

If auth type cannot be determined from the spec, ask: _"Does this API require authentication? If so, what type — bearer token, API key, or basic auth?"_

## Error Handling

<!-- prettier-ignore -->
| Problem | Resolution |
|---------|------------|
| GitHub README 404 | Try `main`, `master`, `develop` branch path variants |
| SDK repo with no spec (e.g. `stripe-node`) | Check for companion spec repo (`owner/openapi`); suggest user provide that URL instead |
| Empty `paths` after extraction | Re-examine source; search for endpoint tables, code blocks with HTTP verbs |
| Duplicate `operationId` | Append method suffix (e.g. `getUser`, `postUser`, `deleteUser`) |
| No base URL found | Use `https://api.example.com` as placeholder |
| Validation loop (3+ retries) | Report what was found; ask the user to provide a more targeted source file |
