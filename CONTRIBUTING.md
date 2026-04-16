# Contributing to Sidekick

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/hesedcasa/sdkck.git
cd sdkck
npm install
npm run build

# Run locally
./bin/dev.js --help

# Run tests
npm test
```

## Creating a Plugin

Sidekick is built on [oclif](https://oclif.io). Any oclif plugin works as a
Sidekick plugin:

```bash
npx oclif generate my-sidekick-plugin
cd my-sidekick-plugin
# Add your commands, then:
sdkck plugins install ./path/to/my-sidekick-plugin
```

See the [Plugin Development Guide](https://hesedcasa.github.io/sdkck/plugins)
for detailed instructions.

## Submitting Changes

1. Fork the repo and create a feature branch
2. Make your changes with tests
3. Run `npm test` and `npm run lint`
4. Open a PR with a clear description of what changed and why

## Plugin Ideas We'd Love

- GitHub (issues, PRs, Actions)
- Slack (messages, channels)
- Linear (issues, projects)
- Notion (pages, databases)
- Stripe (payments, customers)

## Questions?

Open a [Discussion](https://github.com/hesedcasa/sdkck/discussions) or
file an [Issue](https://github.com/hesedcasa/sdkck/issues).
