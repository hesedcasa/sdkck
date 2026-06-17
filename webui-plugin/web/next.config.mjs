import {dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The app is always served behind the plugin's custom Node server, which owns
  // the /api/* routes; Next only renders the UI.
  reactStrictMode: true,
  // The plugin ships its own lockfile alongside the host repo's; pin the trace
  // root to this directory so Next doesn't guess the wrong workspace root.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
}

export default nextConfig
