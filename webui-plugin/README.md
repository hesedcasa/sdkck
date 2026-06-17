# @hesed/webui

An [oclif](https://oclif.io) plugin that serves a **React / Next.js web UI** for
browsing and running [`sdkck`](https://github.com/hesedcasa/sdkck) commands from
your browser.

It introspects the host CLI's command registry — including dynamically
registered API and MCP-client commands — renders each command's flags and
arguments as a form, and executes commands in-process, streaming the output
back to the page.

## Architecture

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  Browser (Next.js + React)  │  HTTP  │  oclif plugin process         │
│  app/  components/           │ <────> │  custom Node server (Next)    │
│  GET  /api/commands          │        │   ├─ /api/commands → introspect│
│  POST /api/run               │        │   └─ /api/run      → executor  │
└─────────────────────────────┘        └──────────────────────────────┘
```

- The oclif command `sdkck webui` starts a custom Node HTTP server.
- The server hands UI requests to Next.js and answers `/api/*` itself, so the
  API has direct access to the live oclif `Config` (no shelling out).
- `src/lib/introspect.ts` turns `config.commands` into serializable metadata.
- `src/lib/executor.ts` runs a command via `config.runCommand`, capturing
  stdout/stderr.

## Install

```sh
sdkck plugins install @hesed/webui
# or, from a checkout:
sdkck plugins link ./webui-plugin
```

## Usage

```sh
sdkck webui                       # dev mode, http://127.0.0.1:4040
sdkck webui --port 8080 --open    # custom port, open browser
sdkck webui --host 0.0.0.0 --no-dev   # bind all interfaces, serve prod build
```

### Flags

| Flag           | Default     | Description                                              |
| -------------- | ----------- | -------------------------------------------------------- |
| `-p, --port`   | `4040`      | Port to listen on.                                       |
| `--host`       | `127.0.0.1` | Host interface to bind.                                  |
| `--dev`        | `true`      | Compile the Next app on the fly. `--no-dev` uses a build.|
| `--open`       | `false`     | Open the UI in the default browser when ready.           |

## Development

```sh
npm install
npm run build:cli   # compile the oclif command (src → dist)
npm run build:web   # production Next.js build (web/.next)
npm run dev:web     # run the Next app standalone (UI only, no live API)
```

> Running `sdkck webui` (dev mode) is the easiest way to exercise the full
> stack, since the API is only available behind the custom server.

## Security note

Commands run with the same privileges as the user who started the server. Bind
to `127.0.0.1` (the default) unless you intend to expose the UI, and never point
it at an untrusted network.
