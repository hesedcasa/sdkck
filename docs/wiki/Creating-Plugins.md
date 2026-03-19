# Creating Plugins

Sidekick's plugin system is built on [oclif](https://oclif.io), the Open CLI Framework. Any oclif plugin is compatible with Sidekick. This guide walks you through creating your own plugin.

## Prerequisites

- Node.js v18+ (v22 recommended)
- npm
- TypeScript knowledge

## Scaffold a New Plugin

Use the oclif CLI to generate a plugin:

```bash
npx oclif generate my-sdkck-plugin
cd my-sdkck-plugin
```

This creates a fully structured plugin with:
- `src/commands/` — Your command implementations
- `test/` — Test scaffolding
- `package.json` — With oclif configuration
- `tsconfig.json` — TypeScript configuration

## Plugin Structure

```
my-sdkck-plugin/
├── src/
│   ├── commands/
│   │   └── my-topic/
│   │       ├── list.ts        # sdkck my-topic list
│   │       ├── create.ts      # sdkck my-topic create
│   │       └── delete.ts      # sdkck my-topic delete
│   └── index.ts
├── test/
│   └── commands/
│       └── my-topic/
│           └── list.test.ts
├── package.json
└── tsconfig.json
```

## Writing a Command

Each command is a TypeScript class that extends `Command` from `@oclif/core`:

```typescript
import {Args, Command, Flags} from '@oclif/core'

export default class MyTopicList extends Command {
  static override args = {
    query: Args.string({description: 'Search query', required: false}),
  }

  static override description = 'List items from my service'

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> "search term"',
  ]

  static override flags = {
    limit: Flags.integer({char: 'l', default: 10, description: 'Maximum items to return'}),
    format: Flags.string({char: 'f', default: 'table', options: ['table', 'json', 'csv']}),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(MyTopicList)

    // Your implementation here
    const items = await this.fetchItems(args.query, flags.limit)

    if (flags.format === 'json') {
      this.log(JSON.stringify(items, null, 2))
    } else {
      // Table output
      for (const item of items) {
        this.log(`${item.id}\t${item.name}`)
      }
    }
  }

  private async fetchItems(query?: string, limit = 10) {
    // Call your API/service here
    return [{id: '1', name: 'Example'}]
  }
}
```

## Key Conventions

### Topic Separator

Sidekick uses **space-based** topic separation (`topicSeparator: " "`). This means:
- `sdkck my-topic list` (not `sdkck my-topic:list`)
- File path `src/commands/my-topic/list.ts` maps to command `my-topic list`

### ESM Modules

Sidekick uses ESM (`"type": "module"` in package.json). Ensure your plugin does too:

```json
{
  "type": "module",
  "module": "Node16"
}
```

### Dependency Injection for Testing

Expose dependencies as public properties so tests can inject mocks:

```typescript
export default class MyCommand extends Command {
  // Allow test injection
  public apiClient = new RealApiClient()

  public async run(): Promise<void> {
    const result = await this.apiClient.fetch()
    this.log(result)
  }
}
```

In tests:

```typescript
const cmd = new MyCommand([], mockConfig)
cmd.apiClient = {fetch: async () => 'mocked result'}
await cmd.run()
```

## Testing Your Plugin

Sidekick's testing pattern directly instantiates command classes:

```typescript
import {expect} from 'chai'

describe('my-topic list', () => {
  it('lists items', async () => {
    const mockConfig = {
      runHook: async () => ({failures: [], successes: []}),
      // ... other required config
    }

    const cmd = new MyTopicList([], mockConfig as any)
    // Set up mocks, run, assert
  })
})
```

Run tests:

```bash
npm test
```

## Local Development with Sidekick

Link your plugin into Sidekick for live development:

```bash
# In your plugin directory
npm run build

# Link to Sidekick
sdkck plugins link .

# Now your commands are available
sdkck my-topic list

# Unlink when done
sdkck plugins unlink my-sdkck-plugin
```

## Publishing

1. Build and test:
   ```bash
   npm run build
   npm test
   ```

2. Publish to npm:
   ```bash
   npm publish
   ```

3. Users install your plugin:
   ```bash
   sdkck plugins install my-sdkck-plugin
   ```

## Making Your Plugin JIT-Compatible

To have your plugin auto-install on first use (like the built-in integrations), users can fork Sidekick and add your plugin to the `oclif.jitPlugins` field in `package.json`:

```json
{
  "oclif": {
    "jitPlugins": {
      "my-sdkck-plugin": "^1.0.0"
    }
  }
}
```

## Tips for Agent-Friendly Plugins

1. **Write clear descriptions** — AI agents use `sdkck search` to discover commands. Good descriptions make your plugin discoverable.
2. **Provide examples** — The `static examples` array is shown in search results with `--details`.
3. **Use structured output** — Support `--json` flags so agents can parse output programmatically.
4. **Keep commands focused** — One command per action. `list`, `create`, `update`, `delete` — not `manage`.
5. **Use meaningful exit codes** — Agents check exit codes. 0 for success, non-zero for failure.
