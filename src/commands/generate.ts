import {Args, Command, Flags} from '@oclif/core'
import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {OpenAI} from 'openai'

export interface ApiEndpoint {
  description: string
  method: string
  operationId: string
  parameters: Array<{
    description: string
    in: 'body' | 'header' | 'path' | 'query'
    name: string
    required: boolean
    type: string
  }>
  path: string
  summary: string
}

export interface ApiSpec {
  baseUrl: string
  description: string
  endpoints: ApiEndpoint[]
  name: string
}

/**
 * Minimal structural interface for the OpenAI client used by _analyzeDoc.
 * Kept as a structural type so tests can inject a plain mock without importing the SDK class.
 */
export interface LlmClient {
  chat: {
    completions: {
      create(params: {
        max_tokens?: number
        messages: Array<{content: string; role: string}>
        model: string
      }): Promise<{choices: Array<{message: {content: null | string}}>}>
    }
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
}

function toPascalCase(str: string): string {
  return slugify(str)
    .split('-')
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
}

function toIdentifier(name: string): string {
  // Replace non-identifier characters and ensure it doesn't start with a digit
  return name.replaceAll(/[^a-zA-Z0-9_]/g, '_').replace(/^(\d)/, '_$1')
}

/** Converts camelCase / PascalCase to a hyphen-slug before slugifying. */
function camelToSlug(str: string): string {
  return str
    .replaceAll(/([A-Z])/g, '-$1')
    .toLowerCase()
    .replace(/^-/, '')
}

function deriveNameFromUrl(url: string): string {
  try {
    const {hostname} = new URL(url)
    // api.example.com -> example, petstore.swagger.io -> petstore
    const parts = hostname.split('.')
    const meaningful = parts.find((p) => !['api', 'dev', 'docs', 'www'].includes(p)) ?? parts[0] ?? 'generated'
    return slugify(meaningful)
  } catch {
    return 'generated'
  }
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

export default class Generate extends Command {
  static args = {
    url: Args.string({description: 'URL of the API documentation to generate a plugin from', required: true}),
  }
static description =
    'Generate an installable oclif plugin from an API documentation URL.\n\nFetches the documentation at the given URL, uses OpenAI (gpt-4o) to extract API endpoints, and scaffolds a fully-structured oclif plugin with one command per endpoint. The resulting directory can be installed directly with `sdkck plugins install <dir>` or linked for development with `sdkck plugins link <dir>`.\n\nRequires OPENAI_API_KEY to be set in the environment.'
static examples = [
    '<%= config.bin %> generate https://petstore.swagger.io/v2/swagger.json',
    '<%= config.bin %> generate https://petstore.swagger.io/v2/swagger.json --name petstore',
    '<%= config.bin %> generate https://api.example.com/openapi.json --name my-api --org @mycompany',
    '<%= config.bin %> generate https://api.example.com/docs --out ./plugins/example',
  ]
static flags = {
    name: Flags.string({
      char: 'n',
      description: 'Plugin name slug — defaults to the hostname of the URL',
      required: false,
    }),
    org: Flags.string({
      char: 'r',
      default: '@hesed',
      description: 'npm org scope for the generated plugin (e.g. @myorg)',
      required: false,
    }),
    out: Flags.string({
      char: 'o',
      description: 'Output directory — defaults to ./<name>',
      required: false,
    }),
  }
/** Exposed for testing: inject a mock client to exercise the LLM path without real API calls. */
  _llmClient: LlmClient | null = null

  async _analyzeDoc(content: string, url: string, client: LlmClient): Promise<ApiSpec> {
    // Keep the payload manageable for the LLM context window
    const trimmed = content.length > 40_000 ? content.slice(0, 40_000) + '\n...(truncated)' : content

    const completion = await client.chat.completions.create({
      // eslint-disable-next-line camelcase
      max_tokens: 4096,
      messages: [
        {
          content:
            'You are an API documentation parser. Respond with only valid JSON — no markdown fences, no prose.',
          role: 'system',
        },
        {
          content: `Parse the API documentation below and return a JSON object with this exact shape:
{
  "name": "short-slug (e.g. stripe, github, petstore)",
  "description": "one-sentence API description",
  "baseUrl": "https://api.example.com",
  "endpoints": [
    {
      "method": "GET",
      "path": "/resource/{id}",
      "operationId": "getResource",
      "summary": "Short summary",
      "description": "Longer description",
      "parameters": [
        {"name": "id", "in": "path", "required": true, "type": "string", "description": "Resource ID"},
        {"name": "expand", "in": "query", "required": false, "type": "string", "description": "Expand fields"}
      ]
    }
  ]
}

Rules:
- Extract up to 20 of the most important endpoints.
- "name" must be a lowercase slug (no spaces, no dots).
- "method" must be uppercase (GET, POST, PUT, PATCH, DELETE).
- For "in" use only: "path", "query", "body", "header".
- If baseUrl is unknown use an empty string.

Source URL: ${url}

Documentation:
${trimmed}`,
          role: 'user',
        },
      ],
      model: 'gpt-4o',
    })

    const text = completion.choices[0]?.message.content ?? ''
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) {
      this.error('Could not extract a JSON API spec from the LLM response. Try a more structured API doc URL.')
    }

    return JSON.parse(match[0]) as ApiSpec
  }

  // ---------------------------------------------------------------------------
  // Overridable in tests
  // ---------------------------------------------------------------------------

  /** Maps an endpoint to a short action name (get, list, create, update, delete, …). */
  _endpointAction(endpoint: ApiEndpoint): string {
    const methodMap: Record<string, string> = {
      DELETE: 'delete',
      GET: 'get',
      PATCH: 'patch',
      POST: 'create',
      PUT: 'update',
    }
    if (endpoint.operationId) {
      const id = slugify(camelToSlug(endpoint.operationId))
      // Only use the operationId if it's richer than a plain HTTP method word
      if (id && !['delete', 'get', 'patch', 'post', 'put'].includes(id)) {
        return id
      }
    }

    return methodMap[endpoint.method.toUpperCase()] ?? endpoint.method.toLowerCase()
  }

  async _fetchDoc(url: string): Promise<string> {
    // eslint-disable-next-line n/no-unsupported-features/node-builtins
    const response = await fetch(url, {
      headers: {Accept: 'application/json, text/plain, text/html, */*'},
    })
    if (!response.ok) {
      this.error(`Failed to fetch ${url}: HTTP ${response.status} ${response.statusText}`)
    }

    return response.text()
  }

  async _generatePlugin(name: string, org: string, outDir: string, spec: ApiSpec): Promise<void> {
    // 1. Pre-compute all command files so we can run all I/O in parallel later.
    //    Action deduplication is stateful, so it must be done sequentially first.
    type FileEntry = {content: string; path: string}
    const commandFiles: FileEntry[] = []
    const commandDirs = new Set<string>()

    const grouped = this._groupEndpoints(spec.endpoints)
    for (const [resource, endpoints] of Object.entries(grouped)) {
      const resourceDir = join(outDir, 'src', 'commands', resource)
      commandDirs.add(resourceDir)

      const usedActions = new Set<string>()
      for (const endpoint of endpoints) {
        let action = this._endpointAction(endpoint)
        // Disambiguate duplicates with a numeric suffix
        if (usedActions.has(action)) {
          let i = 2
          while (usedActions.has(`${action}-${i}`)) i++
          action = `${action}-${i}`
        }

        usedActions.add(action)
        commandFiles.push({
          content: this._genCommandFile(resource, action, endpoint, spec.baseUrl),
          path: join(resourceDir, `${action}.ts`),
        })
        this.log(`  + ${resource} ${action}  (${endpoint.method} ${endpoint.path})`)
      }
    }

    // 2. Create all directories in parallel, then write all files in parallel.
    const allDirs = [join(outDir, 'bin'), join(outDir, 'src', 'commands'), ...commandDirs]
    await Promise.all(allDirs.map((d) => mkdir(d, {recursive: true})))

    const staticFiles: FileEntry[] = [
      {content: this._genPackageJson(name, org, spec), path: join(outDir, 'package.json')},
      {content: this._genTsConfig(), path: join(outDir, 'tsconfig.json')},
      {content: this._genIndex(), path: join(outDir, 'src', 'index.ts')},
      {content: this._genBinRun(), path: join(outDir, 'bin', 'run.js')},
      {content: this._genBinDev(), path: join(outDir, 'bin', 'dev.js')},
      {content: this._genReadme(name, org, spec), path: join(outDir, 'README.md')},
    ]

    await Promise.all([...staticFiles, ...commandFiles].map(({content, path}) => writeFile(path, content, 'utf8')))
  }

  // ---------------------------------------------------------------------------
  // Pure helpers — public for unit-testing
  // ---------------------------------------------------------------------------

  /** Groups endpoints by their primary resource (first non-param path segment). */
  _groupEndpoints(endpoints: ApiEndpoint[]): Record<string, ApiEndpoint[]> {
    const groups: Record<string, ApiEndpoint[]> = {}
    for (const ep of endpoints) {
      const segment = ep.path.split('/').find((s) => s && !s.startsWith('{')) ?? 'root'
      const resource = slugify(segment);
      (groups[resource] ??= []).push(ep)
    }

    return groups
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Generate)
    const {url} = args

    this.log(`Fetching API documentation from ${url} ...`)
    const docContent = await this._fetchDoc(url)

    const client = this._llmClient ?? this._createLlmClient()
    if (!client) {
      this.error('OPENAI_API_KEY is not set. Export it and retry:\n  export OPENAI_API_KEY=sk-...')
    }

    this.log('Analysing API documentation with OpenAI gpt-4o ...')
    const spec = await this._analyzeDoc(docContent, url, client)

    const pluginName = flags.name ?? spec.name ?? deriveNameFromUrl(url)
    const org = flags.org ?? '@hesed'
    const outDir = flags.out ?? `./${pluginName}`

    this.log(`\nGenerating plugin "${org}/${pluginName}" in ${outDir} ...`)
    await this._generatePlugin(pluginName, org, outDir, spec)

    this.log('\nPlugin generated successfully.')
    this.log('\nTo install locally:')
    this.log(`  sdkck plugins install ${outDir}`)
    this.log('To link for active development:')
    this.log(`  sdkck plugins link ${outDir}`)
  }

  // ---------------------------------------------------------------------------
  // Code-generation templates (private)
  // ---------------------------------------------------------------------------

  private _createLlmClient(): LlmClient | null {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) return null
    return new OpenAI({apiKey}) as unknown as LlmClient
  }

  private _genBinDev(): string {
    return `#!/usr/bin/env -S node --loader ts-node/esm --disable-warning=ExperimentalWarning
import {execute} from '@oclif/core'
await execute({development: true, dir: import.meta.url})
`
  }

  private _genBinRun(): string {
    return `#!/usr/bin/env node
import {execute} from '@oclif/core'
await execute({dir: import.meta.url})
`
  }

  private _genCommandFile(resource: string, action: string, endpoint: ApiEndpoint, baseUrl: string): string {
    const className = toPascalCase(resource) + toPascalCase(action)
    const pathParams = endpoint.parameters.filter((p) => p.in === 'path')
    const queryParams = endpoint.parameters.filter((p) => p.in === 'query')
    const method = endpoint.method.toUpperCase()
    const hasBody = ['PATCH', 'POST', 'PUT'].includes(method)
    const needsArgs = pathParams.length > 0

    // Imports — always need Flags (for base-url), conditionally Args
    const oclifImports = ['Command', ...(needsArgs ? ['Args'] : []), 'Flags'].join(', ')

    // Args block
    const argsBlock = needsArgs
      ? [
          '  static args = {',
          ...pathParams.map(
            (p) =>
              `    ${toIdentifier(p.name)}: Args.string({description: ${JSON.stringify(p.description || p.name)}, required: ${p.required}}),`,
          ),
          '  }',
          '',
        ].join('\n')
      : ''

    // Flags block — query params + optional body + always base-url
    const flagLines: string[] = [
      ...queryParams.map(
        (p) =>
          `    ${toIdentifier(p.name)}: Flags.string({description: ${JSON.stringify(p.description || p.name)}, required: ${p.required}}),`,
      ),
      ...(hasBody
        ? [`    data: Flags.string({char: 'd', description: 'JSON request body (as a string)', required: false}),`]
        : []),
      `    'base-url': Flags.string({description: 'Override the API base URL', default: ${JSON.stringify(baseUrl)}}),`,
    ]
    const flagsBlock = ['  static flags = {', ...flagLines, '  }', ''].join('\n')

    // URL construction inside run(): replace {param} with template-literal expressions
    const pathWithInterpolation = endpoint.path.replaceAll(
      /\{(\w+)\}/g,
      (_, n: string) => `\${args.${toIdentifier(n)}}`,
    )
    const urlLine = `    const url = \`\${flags['base-url']}${pathWithInterpolation}\``

    // Query-string handling
    const qsPart =
      queryParams.length > 0
        ? [
            `    const params = new URLSearchParams()`,
            ...queryParams.map(
              (p) => `    if (flags.${toIdentifier(p.name)}) params.set(${JSON.stringify(p.name)}, flags.${toIdentifier(p.name)}!)`,
            ),
            `    const fullUrl = params.toString() ? \`\${url}?\${params}\` : url`,
          ].join('\n')
        : `    const fullUrl = url`

    // Fetch options
    const fetchOptLines = [
      '      {',
      `        method: ${JSON.stringify(method)},`,
      ...(hasBody
        ? [
            `        headers: {'Content-Type': 'application/json'},`,
            `        body: flags.data ?? undefined,`,
          ]
        : []),
      '      }',
    ]
    const fetchOpts = fetchOptLines.join('\n    ')

    const parseDestructure = needsArgs ? 'args, flags' : 'flags'

    return `import {${oclifImports}} from '@oclif/core'

export default class ${className} extends Command {
  static description = ${JSON.stringify(endpoint.summary || endpoint.description || `${method} ${endpoint.path}`)}

${argsBlock}${flagsBlock}
  async run(): Promise<void> {
    const {${parseDestructure}} = await this.parse(${className})
${urlLine}
${qsPart}

    const response = await fetch(fullUrl,
    ${fetchOpts})
    if (!response.ok) {
      this.error(\`Request failed: HTTP \${response.status}\`)
    }

    const body = await response.text()
    try {
      this.log(JSON.stringify(JSON.parse(body), null, 2))
    } catch {
      this.log(body)
    }
  }
}
`
  }

  private _genIndex(): string {
    return `export {run} from '@oclif/core'\n`
  }

  private _genPackageJson(name: string, org: string, spec: ApiSpec): string {
    const pkg = {
      author: '',
      bin: {[name]: './bin/run.js'},
      dependencies: {'@oclif/core': '^4'},
      description: spec.description || `CLI plugin for the ${name} API`,
      devDependencies: {
        '@oclif/test': '^4',
        oclif: '^4',
        shx: '^0.4.0',
        'ts-node': '^10',
        typescript: '^5',
      },
      engines: {node: '>=18.0.0'},
      files: ['./bin', './dist', './oclif.manifest.json'],
      license: 'Apache-2.0',
      main: 'dist/index.js',
      name: `${org}/${name}`,
      oclif: {
        bin: name,
        commands: './dist/commands',
        dirname: name,
        topicSeparator: ' ',
      },
      scripts: {
        build: 'shx rm -rf dist && tsc -b',
        postpack: 'shx rm -f oclif.manifest.json',
        prepack: 'oclif manifest && oclif readme',
        test: 'mocha --forbid-only "test/**/*.test.ts"',
      },
      type: 'module',
      types: 'dist/index.d.ts',
      version: '0.1.0',
    }
    return JSON.stringify(pkg, null, 2)
  }

  private _genReadme(name: string, org: string, spec: ApiSpec): string {
    const lines = [
      `# ${org}/${name}`,
      '',
      spec.description || `CLI plugin for the ${name} API`,
      '',
      '## Install',
      '',
      '```bash',
      `sdkck plugins install ${org}/${name}`,
      '```',
      '',
      '## Commands',
      '',
    ]

    for (const ep of spec.endpoints) {
      const desc = ep.summary || ep.description
      lines.push(`### \`${ep.method} ${ep.path}\``)
      if (desc) {
        lines.push('', desc)
      }

      lines.push('')
    }

    return lines.join('\n')
  }

  private _genTsConfig(): string {
    return JSON.stringify(
      {
        compilerOptions: {
          declaration: true,
          module: 'Node16',
          moduleResolution: 'Node16',
          outDir: './dist',
          rootDir: './src',
          strict: true,
          target: 'ES2022',
        },
        include: ['src/**/*'],
      },
      null,
      2,
    )
  }
}
