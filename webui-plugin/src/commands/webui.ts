import {Command, Flags} from '@oclif/core'
import {spawn} from 'node:child_process'

import {startServer} from '../lib/server.js'

export default class WebUI extends Command {
  static description =
    'Serve a React/Next.js web UI to browse every sdkck command and run them from the browser.\n\n' +
    'The UI lists all available commands (including dynamically registered API and MCP client ' +
    'commands), shows their flags and arguments as a form, and executes them in-process, ' +
    'streaming the output back to the page.'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --port 8080 --open',
    '<%= config.bin %> <%= command.id %> --host 0.0.0.0 --no-dev',
  ]

  static flags = {
    dev: Flags.boolean({
      allowNo: true,
      default: true,
      description: 'Run Next.js in dev mode (compile on the fly). Use --no-dev to serve a production build.',
    }),
    host: Flags.string({
      default: '127.0.0.1',
      description: 'Host interface to bind.',
    }),
    open: Flags.boolean({
      default: false,
      description: 'Open the UI in the default browser once the server is ready.',
    }),
    port: Flags.integer({
      char: 'p',
      default: 4040,
      description: 'Port to listen on.',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(WebUI)

    this.log(`Starting sdkck web UI (${flags.dev ? 'dev' : 'production'} mode)…`)

    const {url} = await startServer({
      config: this.config,
      dev: flags.dev,
      host: flags.host,
      port: flags.port,
    })

    this.log(`\n  ▸ Web UI ready at ${url}`)
    this.log('  ▸ Press Ctrl+C to stop.\n')

    if (flags.open) this.openBrowser(url)

    // The HTTP server keeps the event loop alive; this promise never resolves,
    // so the command stays running until the user interrupts it.
    await new Promise<void>(() => {})
  }

  private openBrowser(url: string): void {
    const command =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
    try {
      spawn(command, args, {detached: true, stdio: 'ignore'}).unref()
    } catch {
      // Opening a browser is best-effort; the URL is already printed.
    }
  }
}
