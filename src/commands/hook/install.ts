import {Command, Flags} from '@oclif/core'
import {existsSync} from 'node:fs'
import {chmod, mkdir, readFile, writeFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join} from 'node:path'

// Shell script installed as a Claude Code PreToolUse hook.
// It enforces sdkck permission rules when Claude invokes sdkck via Bash.
const HOOK_SCRIPT = `#!/usr/bin/env bash
# sdkck Claude Code PreToolUse hook
# Enforces sdkck permission rules when Claude runs sdkck commands via Bash.
# Docs: https://github.com/hesedcasa/sdkck
set -euo pipefail

command -v jq &>/dev/null || exit 0

input=$(cat)
tool_name=$(printf '%s' "$input" | jq -r '.tool_name // empty')
[ "$tool_name" = "Bash" ] || exit 0

cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')

# Only process commands that invoke sdkck
case "$cmd" in
  sdkck\\ *|*\\ sdkck\\ *) ;;
  *) exit 0 ;;
esac

# Build the sdkck command ID from non-flag words following "sdkck"
sdkck_part=$(printf '%s' "$cmd" | sed 's/.*sdkck //')
command_id=""
for word in $sdkck_part; do
  case "$word" in
    -*) break ;;
    *) [ -z "$command_id" ] && command_id="$word" || command_id="$command_id $word" ;;
  esac
done
[ -n "$command_id" ] || exit 0

# Locate permission config (~/.config/sdkck/permission.json)
if [ -n "$XDG_CONFIG_HOME" ]; then
  config_file="$XDG_CONFIG_HOME/sdkck/permission.json"
else
  config_file="$HOME/.config/sdkck/permission.json"
fi
[ -f "$config_file" ] || exit 0

# First matching rule wins (mirrors TypeScript matchesPattern logic)
while IFS= read -r rule; do
  action=$(printf '%s' "$rule" | jq -r '.action')
  pattern=$(printf '%s' "$rule" | jq -r '.pattern')

  matched=false
  if [ "$pattern" = "*" ] || [ "$pattern" = "$command_id" ]; then
    matched=true
  else
    # Topic prefix match: "jira" covers "jira issue create"
    case "$command_id" in
      "$pattern "*) matched=true ;;
    esac
    # Trailing " *" wildcard: "jira *" covers "jira" and "jira issue create"
    case "$pattern" in
      *\\ \\*)
        prefix=$(printf '%s' "$pattern" | sed 's/ \\*$//')
        if [ "$command_id" = "$prefix" ]; then
          matched=true
        else
          case "$command_id" in
            "$prefix "*) matched=true ;;
          esac
        fi
        ;;
    esac
  fi

  if [ "$matched" = "true" ]; then
    if [ "$action" = "disallow" ]; then
      printf '{"permissionDecision":"deny","message":"sdkck: command \\"%s\\" is blocked by a permission rule"}\\n' "$command_id"
    fi
    exit 0
  fi
done < <(jq -c '.rules[]' "$config_file" 2>/dev/null)

# No rule matched — allow by default
exit 0
`

interface HookEntry {
  hooks: {command: string; type: string}[]
  matcher: string
}

interface ClaudeSettings {
  hooks?: {
    [event: string]: HookEntry[]
  }
}

export default class HookInstall extends Command {
  static description =
    'Install sdkck as a Claude Code PreToolUse hook to enforce permission rules on sdkck Bash invocations'

  static examples = [
    '<%= config.bin %> hook install',
    '<%= config.bin %> hook install --settings ~/.claude/settings.local.json',
    '<%= config.bin %> hook install --force',
  ]

  static flags = {
    force: Flags.boolean({
      char: 'f',
      default: false,
      description: 'Overwrite an existing hook entry if already registered',
    }),
    'hooks-dir': Flags.string({
      description: 'Directory where the hook script is written (default: ~/.local/share/sdkck/hooks)',
    }),
    settings: Flags.string({
      description: 'Path to Claude Code settings.json (default: ~/.claude/settings.json)',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(HookInstall)

    const hooksDir = flags['hooks-dir'] ?? join(homedir(), '.local', 'share', 'sdkck', 'hooks')
    const hookScriptPath = join(hooksDir, 'sdkck-hook.sh')
    const settingsPath = flags.settings ?? join(homedir(), '.claude', 'settings.json')

    // 1. Write the hook script
    await mkdir(hooksDir, {recursive: true})
    await writeFile(hookScriptPath, HOOK_SCRIPT, 'utf8')
    await chmod(hookScriptPath, 0o755)
    this.log(`Hook script written to ${hookScriptPath}`)

    // 2. Read or initialise Claude Code settings.json
    let settings: ClaudeSettings = {}
    if (existsSync(settingsPath)) {
      try {
        settings = JSON.parse(await readFile(settingsPath, 'utf8')) as ClaudeSettings
      } catch {
        this.warn(`Could not parse ${settingsPath} — starting with empty settings.`)
      }
    } else {
      const settingsDir = join(settingsPath, '..')
      await mkdir(settingsDir, {recursive: true})
    }

    // 3. Register the hook under PreToolUse / Bash
    settings.hooks ??= {}
    settings.hooks['PreToolUse'] ??= []

    const existing = settings.hooks['PreToolUse'].findIndex(
      (e) => e.matcher === 'Bash' && e.hooks.some((h) => h.command === hookScriptPath),
    )

    if (existing !== -1 && !flags.force) {
      this.log('Hook is already registered. Use --force to overwrite.')
      return
    }

    if (existing !== -1) {
      settings.hooks['PreToolUse'].splice(existing, 1)
    }

    settings.hooks['PreToolUse'].push({
      hooks: [{command: hookScriptPath, type: 'command'}],
      matcher: 'Bash',
    })

    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8')
    this.log(`Registered in ${settingsPath}`)
    this.log(`\nsdkck hook installed. Claude Code will now enforce your sdkck permission rules.`)
    this.log(`\nManage rules with: ${this.config.bin} permission allow/disallow <pattern>`)
  }
}
