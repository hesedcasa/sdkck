```
 ____  _     _      _    _      _    
/ ___|(_) __| | ___| | _(_) ___| | __
\___ \| |/ _` |/ _ \ |/ / |/ __| |/ /   o _
 ___) | | (_| |  __/   <| | (__|   <    /\/
|____/|_|\__,_|\___|_|\_\_|\___|_|\_\    /
```

# Sidekick (sdkck)

### The Best Companion Tool for AI Agents

One CLI to search, connect, and command every tool in your stack. Zero context window bloat. Maximum productivity.

[![Version](https://img.shields.io/npm/v/sdkck.svg)](https://npmjs.org/package/sdkck)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://github.com/hesedcasa/sdkck/blob/main/LICENSE)
[![Downloads/week](https://img.shields.io/npm/dw/sdkck.svg)](https://npmjs.org/package/sdkck)

---

## Key Features

**Semantic Search** — Find the right command instantly with AI-powered search. Your agent runs `sdkck search "create a jira ticket"` and gets exactly what it needs. No browsing tool catalogs.

**Just-In-Time Plugins** — Plugins install automatically on first use. Run a Jira command? The Jira plugin appears. No upfront configuration, no bloated installs.

**Permission System** — Fine-grained control over which commands plugins can execute. Allow, disallow, import, and export permission rules. Perfect for enterprise environments and shared agent setups.

**Plugin Ecosystem** — Connect your entire stack through a single CLI:

| Plugin | What It Does |
|---|---|
| `@hesed/jira` | Create, search, and manage Jira issues |
| `@hesed/bb` | Bitbucket pull requests, repos, and pipelines |
| `@hesed/sentry` | Error tracking and issue management |
| `@hesed/mysql` | Query and manage MySQL databases |
| `@hesed/psql` | Query and manage PostgreSQL databases |
| `@hesed/supabase` | Supabase project and database operations |
| `@hesed/conni` | Confluence page management |

## Quick Start

```bash
# Install globally
npm install -g sdkck

# Search for commands (works immediately — plugins install on demand)
sdkck search "create issue"

# Use any integration — it auto-installs on first run
sdkck jira issue create --project MYPROJ --summary "Fix login bug"

# AI-powered search (set your API key for semantic matching)
export OPENAI_API_KEY=sk-...
sdkck search "find recent errors in production"
```

## How AI Agents Use Sidekick

Sidekick is purpose-built for AI agent workflows. Here's what it looks like when Claude Code uses Sidekick:

```
Agent: I need to check recent Sentry errors and create a Jira ticket.

> sdkck search "sentry errors"          # Discovers the right command
> sdkck sentry issues list --recent     # Gets the data
> sdkck jira issue create ...           # Acts on it
```

## Permissions for Safe Agent Usage

Lock down what your agent can and can't do:

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

We're building the future of agent-tool interaction:

- **Built-in MCP Server** — Expose Sidekick's entire plugin ecosystem as an MCP server with intelligent tool search. Instead of loading hundreds of tool schemas into context, agents query the MCP server with natural language and get back only the relevant tools.

- **Instant Commands from OpenAPI** — Import any OpenAPI/Swagger spec and generate fully functional Sidekick commands automatically. No code required.

- **Agent Workflow Recipes** — Pre-built command chains for common agent workflows (triage Sentry errors to Jira, sync Confluence docs with code changes, automated PR reviews with database checks).

---

# Usage

<!-- usage -->
```sh-session
$ npm install -g sdkck
$ sdkck COMMAND
running command...
$ sdkck (--version)
sdkck/0.5.0 linux-x64 node-v20.20.1
$ sdkck --help [COMMAND]
USAGE
  $ sdkck COMMAND
...
```
<!-- usagestop -->

# Commands

<!-- commands -->
* [`sdkck commands`](#sdkck-commands)
* [`sdkck help [COMMAND]`](#sdkck-help-command)
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

_See code: [@oclif/plugin-commands](https://github.com/oclif/plugin-commands/blob/v4.1.40/src/commands/commands.ts)_

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

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v6.2.37/src/commands/help.ts)_

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

_See code: [src/commands/permission/allow.ts](https://github.com/hesedcasa/sdkck/blob/v0.5.0/src/commands/permission/allow.ts)_

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

_See code: [src/commands/permission/disallow.ts](https://github.com/hesedcasa/sdkck/blob/v0.5.0/src/commands/permission/disallow.ts)_

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

_See code: [src/commands/permission/export.ts](https://github.com/hesedcasa/sdkck/blob/v0.5.0/src/commands/permission/export.ts)_

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

_See code: [src/commands/permission/import.ts](https://github.com/hesedcasa/sdkck/blob/v0.5.0/src/commands/permission/import.ts)_

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

_See code: [src/commands/permission/list.ts](https://github.com/hesedcasa/sdkck/blob/v0.5.0/src/commands/permission/list.ts)_

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

_See code: [src/commands/permission/reset.ts](https://github.com/hesedcasa/sdkck/blob/v0.5.0/src/commands/permission/reset.ts)_

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

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.58/src/commands/plugins/index.ts)_

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

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.58/src/commands/plugins/inspect.ts)_

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

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.58/src/commands/plugins/install.ts)_

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

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.58/src/commands/plugins/link.ts)_

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

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.58/src/commands/plugins/reset.ts)_

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

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.58/src/commands/plugins/uninstall.ts)_

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

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.58/src/commands/plugins/update.ts)_

## `sdkck search QUERY`

Search for available commands

```
USAGE
  $ sdkck search QUERY [-d]

ARGUMENTS
  QUERY  Search term to filter commands by

FLAGS
  -d, --details  Show full help for each matched command

DESCRIPTION
  Search for available commands

EXAMPLES
  $ sdkck search "create pr"

  $ sdkck search jira -d

  $ sdkck search "update jira" --details
```

_See code: [src/commands/search.ts](https://github.com/hesedcasa/sdkck/blob/v0.5.0/src/commands/search.ts)_

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

_See code: [@oclif/plugin-update](https://github.com/oclif/plugin-update/blob/4.7.22/src/commands/update.ts)_

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

_See code: [@oclif/plugin-version](https://github.com/oclif/plugin-version/blob/v2.2.36/src/commands/version.ts)_
<!-- commandsstop -->
