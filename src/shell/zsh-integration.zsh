# Backscroll zsh integration (readable mirror of src/shell/integration.ts).
# The runtime source of truth is integration.ts; keep these in sync.
#
# Add to your ~/.zshrc:   eval "$(bsc init zsh)"
#
# Emits OSC 133 markers around each command (consumed by `bsc rec`) and records
# lightweight metadata via `bsc capture-hook` when not inside a rec session.

zmodload zsh/datetime 2>/dev/null
autoload -Uz add-zsh-hook 2>/dev/null

__bsc_b64() { print -rn -- "$1" | base64 | tr -d '\n'; }

__bsc_preexec() {
  __bsc_cmd="$1"
  __bsc_cwd="$PWD"
  __bsc_start=$EPOCHREALTIME
  __bsc_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
  printf '\033]133;C;cmd=%s;cwd=%s;branch=%s\007' \
    "$(__bsc_b64 "$1")" "$(__bsc_b64 "$PWD")" "$(__bsc_b64 "$__bsc_branch")"
}

__bsc_precmd() {
  local __bsc_exit=$?
  local __bsc_dur=0
  if [[ -n "$__bsc_start" ]]; then
    __bsc_dur=$(( (EPOCHREALTIME - __bsc_start) * 1000 ))
    __bsc_dur=${__bsc_dur%.*}
  fi
  if [[ -n "$__bsc_cmd" ]]; then
    printf '\033]133;D;%s;dur=%s\007' "$__bsc_exit" "$__bsc_dur"
    if [[ -z "$BACKSCROLL_REC" ]]; then
      bsc capture-hook \
        --cmd-b64 "$(__bsc_b64 "$__bsc_cmd")" \
        --cwd-b64 "$(__bsc_b64 "$__bsc_cwd")" \
        --branch-b64 "$(__bsc_b64 "$__bsc_branch")" \
        --exit "$__bsc_exit" --dur "$__bsc_dur" >/dev/null 2>&1 &!
    fi
    unset __bsc_cmd
  fi
  printf '\033]133;A\007'
}

add-zsh-hook preexec __bsc_preexec
add-zsh-hook precmd __bsc_precmd
