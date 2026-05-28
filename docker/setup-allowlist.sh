#!/bin/sh
#
# v1.5 Workstream #8 — Phase A iptables allowlist entrypoint.
#
# Runs as root (via CAP_NET_ADMIN). Reads MENDEL_ALLOWLIST (space-separated
# hostnames), resolves each to IPv4, applies iptables OUTPUT rules so the
# container can ONLY reach those hosts on tcp:80 / tcp:443. DNS (udp:53) is
# allowed so resolution itself works; everything else is dropped.
#
# After setup, drops to the non-root `node` user (UID 1000) and exec's the
# command that came in via `docker run ... <cmd>`. Failure modes:
#   - MENDEL_ALLOWLIST empty                -> leave bridge network open
#                                              (back-compat with v1.0 behavior)
#   - iptables binary missing               -> log + open (so dev without
#                                              CAP_NET_ADMIN doesn't break)
#   - DNS resolution fails for any host     -> log + skip that host
#
# CLAUDE.md §5 Rule 12 (v1.5): iptables allowlist on Phase A.
set -eu

LOG_PREFIX="[allowlist]"
ALLOWLIST="${MENDEL_ALLOWLIST:-}"

apply_rules() {
  if ! command -v iptables >/dev/null 2>&1; then
    echo "$LOG_PREFIX iptables not installed - leaving bridge network open"
    return 0
  fi

  if [ -z "$ALLOWLIST" ]; then
    echo "$LOG_PREFIX MENDEL_ALLOWLIST empty - leaving bridge network open"
    return 0
  fi

  # Default-deny on OUTPUT. Flush first so re-runs don't accumulate.
  if ! iptables -F OUTPUT 2>/dev/null; then
    echo "$LOG_PREFIX iptables flush failed (no CAP_NET_ADMIN?) - leaving bridge open"
    return 0
  fi
  iptables -P OUTPUT DROP

  # Always allow loopback + established/related (return traffic for our
  # own outbound connections) + DNS.
  iptables -A OUTPUT -o lo -j ACCEPT
  iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
  iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
  iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

  ALLOWED_COUNT=0
  for host in $ALLOWLIST; do
    ips=$(getent ahostsv4 "$host" 2>/dev/null | awk '{print $1}' | sort -u)
    if [ -z "$ips" ]; then
      echo "$LOG_PREFIX could not resolve $host - skipping"
      continue
    fi
    for ip in $ips; do
      iptables -A OUTPUT -d "$ip" -p tcp --dport 443 -j ACCEPT
      iptables -A OUTPUT -d "$ip" -p tcp --dport 80 -j ACCEPT
      ALLOWED_COUNT=$((ALLOWED_COUNT + 1))
    done
  done
  echo "$LOG_PREFIX allowlist applied - $ALLOWED_COUNT IP rule(s) ACCEPTED, default DROP"
}

apply_rules

# Drop privileges and exec the actual command. su-exec is provided by alpine's
# `su-exec` package; falls back to `su` if missing.
if command -v su-exec >/dev/null 2>&1; then
  exec su-exec node "$@"
else
  exec su -s /bin/sh node -c "$*"
fi
