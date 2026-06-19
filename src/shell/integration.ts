/**
 * Shell integration snippet generator. [TASK-013]
 *
 * The snippet does two jobs:
 *  1. Emits OSC 133 markers around each command (consumed by `bsc rec`'s PTY).
 *  2. Records lightweight command metadata via `bsc capture-hook` whenever the
 *     shell is NOT inside a `bsc rec` session (the always-on layer). Inside
 *     rec, $BACKSCROLL_REC is set and the PTY already captures the command, so
 *     the hook write is skipped to avoid duplicate rows.
 *
 * Marker payloads (command, cwd, branch) are base64-encoded so arbitrary text
 * survives transport. The capture-hook call is backgrounded (`&!`) so it never
 * blocks the prompt.
 */

const ZSH_INTEGRATION = `# Backscroll zsh integration
# Add to your ~/.zshrc:   eval "$(bsc init zsh)"
zmodload zsh/datetime 2>/dev/null
autoload -Uz add-zsh-hook 2>/dev/null

__bsc_b64() { print -rn -- "$1" | base64 | tr -d '\\n'; }

__bsc_preexec() {
  __bsc_cmd="$1"
  __bsc_cwd="$PWD"
  __bsc_start=$EPOCHREALTIME
  __bsc_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
  printf '\\033]133;C;cmd=%s;cwd=%s;branch=%s\\007' \\
    "$(__bsc_b64 "$1")" "$(__bsc_b64 "$PWD")" "$(__bsc_b64 "$__bsc_branch")"
}

__bsc_precmd() {
  local __bsc_exit=$?
  local __bsc_dur=0
  if [[ -n "$__bsc_start" ]]; then
    __bsc_dur=$(( (EPOCHREALTIME - __bsc_start) * 1000 ))
    __bsc_dur=\${__bsc_dur%.*}
  fi
  if [[ -n "$__bsc_cmd" ]]; then
    printf '\\033]133;D;%s;dur=%s\\007' "$__bsc_exit" "$__bsc_dur"
    if [[ -z "$BACKSCROLL_REC" ]]; then
      bsc capture-hook \\
        --cmd-b64 "$(__bsc_b64 "$__bsc_cmd")" \\
        --cwd-b64 "$(__bsc_b64 "$__bsc_cwd")" \\
        --branch-b64 "$(__bsc_b64 "$__bsc_branch")" \\
        --exit "$__bsc_exit" --dur "$__bsc_dur" >/dev/null 2>&1 &!
    fi
    unset __bsc_cmd
  fi
  printf '\\033]133;A\\007'
}

add-zsh-hook preexec __bsc_preexec
add-zsh-hook precmd __bsc_precmd
`;

// Opt-in: transparently wrap every interactive shell in a recording session so
// command OUTPUT is captured with no manual `bsc rec`. Guarded so it only fires
// in interactive shells, never re-enters (BACKSCROLL_REC), can be disabled per
// session (BACKSCROLL_NO_AUTO), and falls back to a normal shell if bsc is
// missing or fails to start.
const AUTO_RECORD = `# Backscroll auto-record: wrap interactive shells in a recording session.
if [[ -o interactive && -z "$BACKSCROLL_REC" && -z "$BACKSCROLL_NO_AUTO" ]] && command -v bsc >/dev/null 2>&1; then
  bsc rec && exit
fi
`;

export interface SnippetOptions {
  /** Reserved for future divergence between rec-injected and installed forms. */
  forRec?: boolean;
  /** Prepend the auto-record wrapper (always-on output capture). */
  autoRecord?: boolean;
}

/** Return the zsh integration snippet as a sourceable string. */
export function zshSnippet(opts: SnippetOptions = {}): string {
  // Never auto-record inside the rec subshell itself (it sets BACKSCROLL_REC,
  // so the guard would skip anyway — but omit it for clarity/safety).
  const head = opts.autoRecord && !opts.forRec ? `${AUTO_RECORD}\n` : '';
  return head + ZSH_INTEGRATION;
}

/** Shells supported by `bsc init` in v0. */
export const SUPPORTED_SHELLS = ['zsh'] as const;
export type SupportedShell = (typeof SUPPORTED_SHELLS)[number];
