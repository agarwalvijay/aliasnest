#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-start}"

add_rule_if_missing() {
  local table="$1"
  shift
  if ! /sbin/iptables -t "$table" -C "$@" 2>/dev/null; then
    /sbin/iptables -t "$table" -A "$@"
  fi
}

del_rule_if_exists() {
  local table="$1"
  shift
  if /sbin/iptables -t "$table" -C "$@" 2>/dev/null; then
    /sbin/iptables -t "$table" -D "$@"
  fi
}

if [[ "$MODE" == "start" ]]; then
  add_rule_if_missing nat PREROUTING -p tcp --dport 25 -j REDIRECT --to-ports 2525
  add_rule_if_missing nat OUTPUT -p tcp -d 127.0.0.1 --dport 25 -j REDIRECT --to-ports 2525
elif [[ "$MODE" == "stop" ]]; then
  del_rule_if_exists nat PREROUTING -p tcp --dport 25 -j REDIRECT --to-ports 2525
  del_rule_if_exists nat OUTPUT -p tcp -d 127.0.0.1 --dport 25 -j REDIRECT --to-ports 2525
else
  echo "Usage: $0 [start|stop]" >&2
  exit 2
fi
