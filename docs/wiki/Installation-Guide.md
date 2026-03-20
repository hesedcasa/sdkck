# Installation Guide

## Prerequisites

- **Node.js** v18.0.0 or higher (v22+ recommended)
- **npm** (comes with Node.js)

### Verify Node.js

```bash
node --version   # Should print v18.x.x or higher
npm --version    # Should print 8.x.x or higher
```

If you need to install or update Node.js, we recommend [nvm](https://github.com/nvm-sh/nvm):

```bash
nvm install 22
nvm use 22
```

## Install Sidekick

```bash
npm install -g sdkck
```

Verify the installation:

```bash
sdkck version
sdkck --help
```

## First Run

Sidekick is ready to use immediately after installation. Try searching for available commands:

```bash
sdkck search "list"
```

The first time you run a command from a JIT plugin (like `@hesed/jira`), Sidekick will automatically download and install it. No manual plugin setup required.

## Environment Variables

| Variable | Purpose | Required |
|---|---|---|
| `OPENAI_API_KEY` | Enables AI-powered semantic search via GPT-4o | Optional (falls back to fuzzy matching) |

### Plugin-Specific Variables

Each plugin may require its own credentials. For example:

- **Jira**: Atlassian API token (see [Getting Started guide](https://dev.to/allentcm/getting-started-with-sidekick-sdkck-a-complete-setup-guide-460m))
- **MySQL/PostgreSQL**: Database connection credentials
- **Sentry**: Sentry auth token
- **Supabase**: Supabase project credentials

### Security Best Practices

- Never commit API tokens to version control
- Use `.env` files with `.gitignore`
- Consider a secrets manager (1Password CLI, AWS Secrets Manager) for team environments
- Use minimum required scopes when creating tokens

## Updating Sidekick

```bash
# Update to the latest version
sdkck update

# Update to a specific version
sdkck update --version 1.0.0

# See available versions
sdkck update --available

# Interactive version selection
sdkck update --interactive
```

Sidekick includes auto-update checking (debounced to once per week) so you'll be notified of new versions.

## Updating Plugins

```bash
sdkck plugins update
```

## Uninstalling

```bash
npm uninstall -g sdkck
```

To also remove all plugin data and configuration:

```bash
# Remove plugins
sdkck plugins reset --hard

# Then uninstall
npm uninstall -g sdkck
```
