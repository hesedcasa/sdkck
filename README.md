```
 ____  _     _      _    _      _    
/ ___|(_) __| | ___| | _(_) ___| | __
\___ \| |/ _` |/ _ \ |/ / |/ __| |/ /
 ___) | | (_| |  __/   <| | (__|   < 
|____/|_|\__,_|\___|_|\_\_|\___|_|\_\

```

# Sidekick (sdkck)

### The Best Companion Tool for AI Agents

One CLI to search, connect, and command every tool in your stack. Zero context window bloat. Maximum productivity.

[![Version](https://img.shields.io/npm/v/sdkck.svg)](https://npmjs.org/package/sdkck)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://github.com/hesedcasa/sdkck/blob/main/LICENSE)
[![Downloads/week](https://img.shields.io/npm/dw/sdkck.svg)](https://npmjs.org/package/sdkck)

---

## Key Features

### Instant Commands from OpenAPI/Postman

- Point Sidekick at any OpenAPI/Swagger spec or Postman collection — local file or URL — and every endpoint becomes a CLI command instantly.

  ```bash
  # Import an OpenAPI spec from a URL or local file
  sdkck openapi import https://petstore3.swagger.io/api/v3/openapi.json --name petstore

  # Import a Postman collection the same way
  sdkck openapi import ./postman_collection.json --name myapi

  # Every operation is now a real command
  sdkck petstore listPets
  sdkck petstore getPetById --param petId=42
  sdkck petstore createPet --body name=Fido --body tag=dog

  # Searchable like any built-in command
  sdkck search "list pets"
  ```

- Auth is built in — configure bearer tokens, API keys, or basic auth once and every generated command uses it automatically:

  ```bash
  sdkck openapi auth petstore --type bearer --token sk-...
  sdkck openapi auth myapi --type apikey --api-key mykey --api-key-header X-API-Key
  ```

### Semantic Search

- Find the right command instantly with fuzzy algorithem or AI-powered. Your agent runs `sdkck search "create a jira ticket"` and gets exactly what it needs. No browsing tool catalogs.

### Plugins

- Official plugins install automatically on first use. No upfront configuration, no bloated installs.
- | Plugin            | What It Does                                  |
  | ----------------- | --------------------------------------------- |
  | `@hesed/jira`     | Create, search, and manage Jira issues        |
  | `@hesed/bb`       | Bitbucket pull requests, repos, and pipelines |
  | `@hesed/sentry`   | Error tracking and issue management           |
  | `@hesed/mysql`    | Query and manage MySQL databases              |
  | `@hesed/psql`     | Query and manage PostgreSQL databases         |
  | `@hesed/supabase` | Supabase project and database operations      |
  | `@hesed/conni`    | Confluence page management                    |

- Build your own plugin. Sidekick is built on [oclif](https://oclif.io), so any oclif plugin works as a Sidekick plugin. Create a package that exports oclif commands and install it with:

  ```bash
  # Install any oclif-compatible plugin directly
  sdkck plugins install my-custom-plugin

  # Or from a GitHub repo
  sdkck plugins install myorg/my-custom-plugin
  ```

### Permission System

- Fine-grained control over which commands plugins can execute. Allow, disallow, import, and export permission rules. Perfect for enterprise environments and shared agent setups.

## Why Sidekick?

AI agents waste most of their context window loading tool schemas they'll never use.

Sidekick flips this. **Zero tools loaded upfront.** Your agent searches for what it needs 
on demand, gets back only the relevant commands, and executes them. The context window 
stays clean for actual reasoning.

## Quick Start

```bash
# Install globally
npm install -g sdkck

# Turn any OpenAPI spec into CLI commands instantly
sdkck openapi import https://petstore3.swagger.io/api/v3/openapi.json --name petstore
sdkck petstore listPets

# Search for commands
sdkck search "create issue"

# Use any integration — it auto-installs on first run
sdkck jira issue create --project MYPROJ --summary "Fix login bug"

# AI-powered search (set your API key for semantic matching)
export OPENAI_API_KEY=sk-...
sdkck search "find recent errors in production"
```

## How AI Agents Use Sidekick

- Install as Claude Code plugin:
```bash
claude plugin marketplace add hesedcasa/sdkck
claude plugin install sidekick@sidekick
```

- Or simply add this instruction to your AGENT.md or CLAUDE.md file
```
Before any tool call run `sdkck commands | grep <keywords>` to find the available tools in sdkck, e.g.: `sdkck commands | grep -i "\|atlassian\|issue"`
```

- Sidekick is purpose-built for AI agent workflows. Here's what it looks like when Claude Code uses Sidekick:

```
Agent: I need to check recent Sentry errors and create a Jira ticket.

> sdkck search "sentry errors"          # Discovers the right command
> sdkck sentry issues list --recent     # Gets the data
> sdkck jira issue create ...           # Acts on it
```

- Add Sidekick as MCP server:

```json
{
  "mcpServers": {
    "sidekick": {
      "command": "sdkck",
      "args": ["mcp", "start"]
    }
  }
}
```

## Permissions for Safe Agent Usage

- Lock down what your agent can and can't do:

  ```bash
  # Allow only Jira read commands
  sdkck permission allow "jira issue list"
  sdkck permission allow "jira issue view"
  sdkck permission disallow "jira *"

  # Export your permission config for team sharing
  sdkck permission export permissions.json

  # View current rules
  sdkck permission list
  ```

## Roadmap

- Subjected to changes overtime

### Agent Workflow Recipes

- Pre-built command chains for common agent workflows (triage Sentry errors to Jira, sync Confluence docs with code changes, automated PR reviews with database checks).

### Output Piping & Chaining

- Pipe the output of one command directly into another. Run `sdkck sentry issues list | sdkck jira issue create` and let Sidekick wire up the data transformation automatically, so agents can build multi-step workflows from single-purpose commands.

### Command History & Replay

- Record every command an agent runs, with inputs, outputs, and timing. Replay any past command or sequence, diff outputs between runs, and audit exactly what your agent did and when.

### Rate Limiting & Quota Guards

- Declare per-command or per-API rate limits and let Sidekick enforce them before a request is sent. Prevents agents from accidentally hammering external APIs or blowing through paid-tier quotas.

### Response Caching

- Cache the results of read-only commands for a configurable TTL. Agents that search the same Jira project or call the same OpenAPI endpoint repeatedly get instant responses without hitting the network.

---

# Usage

<!-- usage -->
```sh-session
$ npm install -g sdkck
$ sdkck COMMAND
running command...
$ sdkck (--version)
sdkck/0.19.0 linux-x64 node-v20.20.2
$ sdkck --help [COMMAND]
USAGE
  $ sdkck COMMAND
...
```
<!-- usagestop -->

# Commands

<!-- commands -->
* [`sdkck api auth NAME`](#sdkck-api-auth-name)
* [`sdkck api call NAME OPERATIONID`](#sdkck-api-call-name-operationid)
* [`sdkck api config NAME`](#sdkck-api-config-name)
* [`sdkck api import SOURCE`](#sdkck-api-import-source)
* [`sdkck api list [NAME]`](#sdkck-api-list-name)
* [`sdkck api remove NAME`](#sdkck-api-remove-name)
* [`sdkck commands`](#sdkck-commands)
* [`sdkck help [COMMAND]`](#sdkck-help-command)
* [`sdkck mcp start`](#sdkck-mcp-start)
* [`sdkck permission allow PATTERN`](#sdkck-permission-allow-pattern)
* [`sdkck permission disallow PATTERN`](#sdkck-permission-disallow-pattern)
* [`sdkck permission export FILE`](#sdkck-permission-export-file)
* [`sdkck permission import FILE`](#sdkck-permission-import-file)
* [`sdkck permission list`](#sdkck-permission-list)
* [`sdkck permission reset`](#sdkck-permission-reset)
* [`sdkck plugins`](#sdkck-plugins)
* [`sdkck plugins add PLUGIN`](#sdkck-plugins-add-plugin)
* [`sdkck plugins:inspect PLUGIN...`](#sdkck-pluginsinspect-plugin)
* [`sdkck plugins install PLUGIN`](#sdkck-plugins-install-plugin)
* [`sdkck plugins link PATH`](#sdkck-plugins-link-path)
* [`sdkck plugins remove [PLUGIN]`](#sdkck-plugins-remove-plugin)
* [`sdkck plugins reset`](#sdkck-plugins-reset)
* [`sdkck plugins uninstall [PLUGIN]`](#sdkck-plugins-uninstall-plugin)
* [`sdkck plugins unlink [PLUGIN]`](#sdkck-plugins-unlink-plugin)
* [`sdkck plugins update`](#sdkck-plugins-update)
* [`sdkck search QUERY`](#sdkck-search-query)
* [`sdkck update [CHANNEL]`](#sdkck-update-channel)
* [`sdkck version`](#sdkck-version)

## `sdkck api auth NAME`

Update the authentication settings for an imported API spec

```
USAGE
  $ sdkck api auth NAME [--api-key <value>] [--api-key-header <value>] [--header <value>...] [--password
    <value>] [--show] [--token <value>] [--type none|bearer|apikey|basic|custom] [--username <value>]

ARGUMENTS
  NAME  API name to update authentication for

FLAGS
  --api-key=<value>         API key value (used with --type apikey)
  --api-key-header=<value>  [default: X-API-Key] Header name for the API key
  --header=<value>...       Custom header in Key=Value format (used with --type custom, repeatable)
  --password=<value>        Password for basic auth
  --show                    Show the current authentication settings (tokens are redacted)
  --token=<value>           Bearer token
  --type=<option>           Authentication type to configure
                            <options: none|bearer|apikey|basic|custom>
  --username=<value>        Username for basic auth

DESCRIPTION
  Update the authentication settings for an imported API spec

EXAMPLES
  $ sdkck api auth petstore --type bearer --token sk-...

  $ sdkck api auth petstore --type apikey --api-key mykey

  $ sdkck api auth petstore --type apikey --api-key mykey --api-key-header Authorization

  $ sdkck api auth petstore --type basic --username user --password secret

  $ sdkck api auth petstore --type custom --header X-Tenant-ID=acme --header X-App-Key=secret

  $ sdkck api auth petstore --type none

  $ sdkck api auth petstore --show
```

_See code: [src/commands/api/auth.ts](https://github.com/hesedcasa/sdkck/blob/v0.19.0/src/commands/api/auth.ts)_

## `sdkck api call NAME OPERATIONID`

Call an imported API operation

```
USAGE
  $ sdkck api call NAME OPERATIONID [--base-url <value>] [--body <value>...] [--header <value>...] [--param
    <value>...] [--raw]

ARGUMENTS
  NAME         API name (as shown in `api list`)
  OPERATIONID  Operation ID to call (as shown in `api list <name>`)

FLAGS
  --base-url=<value>   Override the base URL for this request
  --body=<value>...    Request body field as key=value (repeatable)
  --header=<value>...  Extra request header as Key=Value (repeatable)
  --param=<value>...   Path or query parameter as key=value (repeatable)
  --raw                Print the raw response body without JSON formatting

DESCRIPTION
  Call an imported API operation

EXAMPLES
  $ sdkck api call petstore listPets

  $ sdkck api call petstore getPetById --param petId=42

  $ sdkck api call petstore createPet --body name=Fido --body tag=dog

  $ sdkck api call petstore listPets --query limit=10 --header X-Trace=abc
```

_See code: [src/commands/api/call.ts](https://github.com/hesedcasa/sdkck/blob/v0.19.0/src/commands/api/call.ts)_

## `sdkck api config NAME`

Update configuration for an imported API spec

```
USAGE
  $ sdkck api config NAME [--base-url <value>] [--description <value>] [--insecure] [--rename <value>] [--title
    <value>]

ARGUMENTS
  NAME  API name (as shown in `api list`)

FLAGS
  --base-url=<value>     New base URL for API calls
  --description=<value>  New description for the spec
  --[no-]insecure        Skip TLS certificate verification (--no-insecure to disable)
  --rename=<value>       New short identifier for this API
  --title=<value>        New display title for the spec

DESCRIPTION
  Update configuration for an imported API spec

EXAMPLES
  $ sdkck api config petstore --base-url https://api.example.com

  $ sdkck api config petstore --rename mystore

  $ sdkck api config petstore --title "My Petstore" --description "A pet store API"
```

_See code: [src/commands/api/config.ts](https://github.com/hesedcasa/sdkck/blob/v0.19.0/src/commands/api/config.ts)_

## `sdkck api import SOURCE`

Import an OpenAPI spec, Postman collection, or GraphQL schema (SDL/introspection/endpoint) and register its operations as commands

```
USAGE
  $ sdkck api import SOURCE [--api-key <value>] [--api-key-header <value>] [--auth-type
    none|bearer|apikey|basic] [--base-url <value>] [--graphql] [--insecure] [--name <value>] [--password <value>]
    [--selection-depth <value>] [--token <value>] [--username <value>]

ARGUMENTS
  SOURCE  Path to a local OpenAPI/Postman/GraphQL spec or URL (REST or GraphQL endpoint)

FLAGS
  --api-key=<value>          API key value (used with --auth-type apikey)
  --api-key-header=<value>   [default: X-API-Key] Header name for the API key
  --auth-type=<option>       Authentication type
                             <options: none|bearer|apikey|basic>
  --base-url=<value>         Override the base URL for API calls (GraphQL endpoint URL for GraphQL imports)
  --graphql                  Treat the source as a GraphQL schema (SDL, introspection JSON, or live endpoint)
  --insecure                 Skip TLS certificate verification (useful for self-signed certs)
  --name=<value>             Short identifier for this API (defaults to the spec title slug)
  --password=<value>         Password for basic auth
  --selection-depth=<value>  [default: 3] Max depth of auto-generated GraphQL selection sets (GraphQL imports only)
  --token=<value>            Bearer token (used with --auth-type bearer)
  --username=<value>         Username for basic auth

DESCRIPTION
  Import an OpenAPI spec, Postman collection, or GraphQL schema (SDL/introspection/endpoint) and register its operations
  as commands

EXAMPLES
  $ sdkck api import ./petstore.json  --name petstore

  $ sdkck api import ./postman_collection.json --name myapi

  $ sdkck api import https://petstore3.swagger.io/api/v3/openapi.json

  $ sdkck api import ./schema.graphql --base-url https://api.example.com/graphql

  $ sdkck api import https://api.example.com/graphql --name github

  $ sdkck api import ./api.yaml --auth-type bearer --token sk-...

  $ sdkck api import ./api.yaml --auth-type apikey --api-key mykey --api-key-header X-API-Key

  $ sdkck api import ./api.yaml --auth-type basic --username user --password pass
```

_See code: [src/commands/api/import.ts](https://github.com/hesedcasa/sdkck/blob/v0.19.0/src/commands/api/import.ts)_

## `sdkck api list [NAME]`

List imported API specs and their available operations

```
USAGE
  $ sdkck api list [NAME]

ARGUMENTS
  [NAME]  API name to list operations for (omit to list all imported APIs)

DESCRIPTION
  List imported API specs and their available operations

EXAMPLES
  $ sdkck api list

  $ sdkck api list petstore
```

_See code: [src/commands/api/list.ts](https://github.com/hesedcasa/sdkck/blob/v0.19.0/src/commands/api/list.ts)_

## `sdkck api remove NAME`

Remove an imported API spec

```
USAGE
  $ sdkck api remove NAME

ARGUMENTS
  NAME  API name to remove

DESCRIPTION
  Remove an imported API spec

EXAMPLES
  $ sdkck api remove petstore
```

_See code: [src/commands/api/remove.ts](https://github.com/hesedcasa/sdkck/blob/v0.19.0/src/commands/api/remove.ts)_

## `sdkck commands`

List all sdkck commands.

```
USAGE
  $ sdkck commands [--json] [-c id|plugin|summary|type... | --tree] [--deprecated] [-x | ] [--hidden]
    [--no-truncate | ] [--sort id|plugin|summary|type | ]

FLAGS
  -c, --columns=<option>...  Only show provided columns (comma-separated).
                             <options: id|plugin|summary|type>
  -x, --extended             Show extra columns.
      --deprecated           Show deprecated commands.
      --hidden               Show hidden commands.
      --no-truncate          Do not truncate output.
      --sort=<option>        [default: id] Property to sort by.
                             <options: id|plugin|summary|type>
      --tree                 Show tree of commands.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List all sdkck commands.
```

_See code: [@oclif/plugin-commands](https://github.com/oclif/plugin-commands/blob/4.1.45/src/commands/commands.ts)_

## `sdkck help [COMMAND]`

Display help for sdkck.

```
USAGE
  $ sdkck help [COMMAND...] [-n]

ARGUMENTS
  [COMMAND...]  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for sdkck.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/6.2.44/src/commands/help.ts)_

## `sdkck mcp start`

Start an MCP server exposing all CLI commands as tools

```
USAGE
  $ sdkck mcp start [--host <value>] [--port <value>] [--transport stdio|http]

FLAGS
  --host=<value>        [default: 127.0.0.1] IP address to listen on (HTTP transport only)
  --port=<value>        [default: 3000] Port to listen on (HTTP transport only)
  --transport=<option>  [default: stdio] Transport to use
                        <options: stdio|http>

DESCRIPTION
  Start an MCP server exposing all CLI commands as tools

EXAMPLES
  $ sdkck mcp start

  $ sdkck mcp start --transport http

  $ sdkck mcp start --transport http --port 3001

  $ sdkck mcp start --transport http --host 0.0.0.0
```

_See code: [src/commands/mcp/start.ts](https://github.com/hesedcasa/sdkck/blob/v0.19.0/src/commands/mcp/start.ts)_

## `sdkck permission allow PATTERN`

Allow a command pattern in the plugin command permission list

```
USAGE
  $ sdkck permission allow PATTERN

ARGUMENTS
  PATTERN  Command pattern to allow. Use a full command ID ("jira issue create"), a topic ("jira"), a topic wildcard
           ("jira *"), or "*" for everything.

DESCRIPTION
  Allow a command pattern in the plugin command permission list

EXAMPLES
  $ sdkck permission allow "*"

  $ sdkck permission allow jira

  $ sdkck permission allow "jira *"

  $ sdkck permission allow "jira issue create"
```

_See code: [src/commands/permission/allow.ts](https://github.com/hesedcasa/sdkck/blob/v0.19.0/src/commands/permission/allow.ts)_

## `sdkck permission disallow PATTERN`

Disallow a command pattern in the plugin command permission list

```
USAGE
  $ sdkck permission disallow PATTERN

ARGUMENTS
  PATTERN  Command pattern to disallow. Use a full command ID ("jira issue create"), a topic ("jira"), a topic wildcard
           ("jira *"), or "*" for everything.

DESCRIPTION
  Disallow a command pattern in the plugin command permission list

EXAMPLES
  $ sdkck permission disallow "*"

  $ sdkck permission disallow jira

  $ sdkck permission disallow "jira *"

  $ sdkck permission disallow "jira issue create"
```

_See code: [src/commands/permission/disallow.ts](https://github.com/hesedcasa/sdkck/blob/v0.19.0/src/commands/permission/disallow.ts)_

## `sdkck permission export FILE`

Export the plugin command permission configuration to a JSON file

```
USAGE
  $ sdkck permission export FILE

ARGUMENTS
  FILE  Path to the JSON file to export the permission configuration to

DESCRIPTION
  Export the plugin command permission configuration to a JSON file

EXAMPLES
  $ sdkck permission export permission.json
```

_See code: [src/commands/permission/export.ts](https://github.com/hesedcasa/sdkck/blob/v0.19.0/src/commands/permission/export.ts)_

## `sdkck permission import FILE`

Import the plugin command permission configuration from a JSON file

```
USAGE
  $ sdkck permission import FILE

ARGUMENTS
  FILE  Path to the JSON file to import the permission configuration from

DESCRIPTION
  Import the plugin command permission configuration from a JSON file

EXAMPLES
  $ sdkck permission import permission.json
```

_See code: [src/commands/permission/import.ts](https://github.com/hesedcasa/sdkck/blob/v0.19.0/src/commands/permission/import.ts)_

## `sdkck permission list`

List all rules in the plugin command permission list

```
USAGE
  $ sdkck permission list

DESCRIPTION
  List all rules in the plugin command permission list

EXAMPLES
  $ sdkck permission list
```

_See code: [src/commands/permission/list.ts](https://github.com/hesedcasa/sdkck/blob/v0.19.0/src/commands/permission/list.ts)_

## `sdkck permission reset`

Reset all plugin command permission rules

```
USAGE
  $ sdkck permission reset [--confirm]

FLAGS
  --confirm  Skip the confirmation prompt

DESCRIPTION
  Reset all plugin command permission rules

EXAMPLES
  $ sdkck permission reset

  $ sdkck permission reset --confirm
```

_See code: [src/commands/permission/reset.ts](https://github.com/hesedcasa/sdkck/blob/v0.19.0/src/commands/permission/reset.ts)_

## `sdkck plugins`

List installed plugins.

```
USAGE
  $ sdkck plugins [--json] [--core]

FLAGS
  --core  Show core plugins.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List installed plugins.

EXAMPLES
  $ sdkck plugins
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.64/src/commands/plugins/index.ts)_

## `sdkck plugins add PLUGIN`

Installs a plugin into sdkck.

```
USAGE
  $ sdkck plugins add PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into sdkck.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the SDKCK_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the SDKCK_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ sdkck plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ sdkck plugins add myplugin

  Install a plugin from a github url.

    $ sdkck plugins add https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ sdkck plugins add someuser/someplugin
```

## `sdkck plugins:inspect PLUGIN...`

Displays installation properties of a plugin.

```
USAGE
  $ sdkck plugins inspect PLUGIN...

ARGUMENTS
  PLUGIN...  [default: .] Plugin to inspect.

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Displays installation properties of a plugin.

EXAMPLES
  $ sdkck plugins inspect myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.64/src/commands/plugins/inspect.ts)_

## `sdkck plugins install PLUGIN`

Installs a plugin into sdkck.

```
USAGE
  $ sdkck plugins install PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into sdkck.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the SDKCK_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the SDKCK_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ sdkck plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ sdkck plugins install myplugin

  Install a plugin from a github url.

    $ sdkck plugins install https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ sdkck plugins install someuser/someplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.64/src/commands/plugins/install.ts)_

## `sdkck plugins link PATH`

Links a plugin into the CLI for development.

```
USAGE
  $ sdkck plugins link PATH [-h] [--install] [-v]

ARGUMENTS
  PATH  [default: .] path to plugin

FLAGS
  -h, --help          Show CLI help.
  -v, --verbose
      --[no-]install  Install dependencies after linking the plugin.

DESCRIPTION
  Links a plugin into the CLI for development.

  Installation of a linked plugin will override a user-installed or core plugin.

  e.g. If you have a user-installed or core plugin that has a 'hello' command, installing a linked plugin with a 'hello'
  command will override the user-installed or core plugin implementation. This is useful for development work.


EXAMPLES
  $ sdkck plugins link myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.64/src/commands/plugins/link.ts)_

## `sdkck plugins remove [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ sdkck plugins remove [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ sdkck plugins unlink
  $ sdkck plugins remove

EXAMPLES
  $ sdkck plugins remove myplugin
```

## `sdkck plugins reset`

Remove all user-installed and linked plugins.

```
USAGE
  $ sdkck plugins reset [--hard] [--reinstall]

FLAGS
  --hard       Delete node_modules and package manager related files in addition to uninstalling plugins.
  --reinstall  Reinstall all plugins after uninstalling.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.64/src/commands/plugins/reset.ts)_

## `sdkck plugins uninstall [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ sdkck plugins uninstall [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ sdkck plugins unlink
  $ sdkck plugins remove

EXAMPLES
  $ sdkck plugins uninstall myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.64/src/commands/plugins/uninstall.ts)_

## `sdkck plugins unlink [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ sdkck plugins unlink [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ sdkck plugins unlink
  $ sdkck plugins remove

EXAMPLES
  $ sdkck plugins unlink myplugin
```

## `sdkck plugins update`

Update installed plugins.

```
USAGE
  $ sdkck plugins update [-h] [-v]

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Update installed plugins.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.64/src/commands/plugins/update.ts)_

## `sdkck search QUERY`

Search for available commands

```
USAGE
  $ sdkck search QUERY [--json] [-d] [-n <value>]

ARGUMENTS
  QUERY  Search term to filter commands by

FLAGS
  -d, --details        Show full help for each matched command
  -n, --limit=<value>  [default: 5] Maximum number of results to return

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Search for available commands

EXAMPLES
  $ sdkck search "create pr"

  $ sdkck search jira -d

  $ sdkck search "update jira" --details
```

_See code: [src/commands/search.ts](https://github.com/hesedcasa/sdkck/blob/v0.19.0/src/commands/search.ts)_

## `sdkck update [CHANNEL]`

update the sdkck CLI

```
USAGE
  $ sdkck update [CHANNEL] [--force |  | [-a | -v <value> | -i]] [-b ]

FLAGS
  -a, --available        See available versions.
  -b, --verbose          Show more details about the available versions.
  -i, --interactive      Interactively select version to install. This is ignored if a channel is provided.
  -v, --version=<value>  Install a specific version.
      --force            Force a re-download of the requested version.

DESCRIPTION
  update the sdkck CLI

EXAMPLES
  Update to the stable channel:

    $ sdkck update stable

  Update to a specific version:

    $ sdkck update --version 1.0.0

  Interactively select version:

    $ sdkck update --interactive

  See available versions:

    $ sdkck update --available
```

_See code: [@oclif/plugin-update](https://github.com/oclif/plugin-update/blob/4.7.35/src/commands/update.ts)_

## `sdkck version`

```
USAGE
  $ sdkck version [--json] [--verbose]

FLAGS
  --verbose  Show additional information about the CLI.

GLOBAL FLAGS
  --json  Format output as json.

FLAG DESCRIPTIONS
  --verbose  Show additional information about the CLI.

    Additionally shows the architecture, node version, operating system, and versions of plugins that the CLI is using.
```

_See code: [@oclif/plugin-version](https://github.com/oclif/plugin-version/blob/2.2.41/src/commands/version.ts)_
<!-- commandsstop -->
