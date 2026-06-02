#!/bin/sh
#
# v2.2.x polish — Debian-flavored variant of setup-allowlist.sh.
#
# Same contract as docker/setup-allowlist.sh (the alpine version used by
# the Node sandbox) — applied to the Python / Go / Rust sandboxes which
# use debian-based base images (rust:1-slim, golang:1.x-bookworm,
# python:3.13-slim). Differences from the alpine variant:
#   - `getent` is part of glibc on debian (no extra package needed)
#   - dropping privileges uses `gosu` (debian) instead of `su-exec` (alpine)
#   - the non-root user is `mendel` (UID 1000), set by each image's Dockerfile
#
# Runs as root (via CAP_NET_ADMIN). Reads MENDEL_ALLOWLIST (space-separated
# hostnames), resolves each to IPv4, applies iptables OUTPUT rules so the
# container can ONLY reach those hosts on tcp:80 / tcp:443. DNS (udp:53)
# is allowed so resolution itself works; everything else is dropped.
#
# After setup, drops to the non-root `mendel` user and exec's the command.
# Failure modes match the alpine variant:
#   - MENDEL_ALLOWLIST empty -> leave bridge network open (back-compat)
#   - iptables binary missing OR no CAP_NET_ADMIN -> log + open (so dev
#     without privileged docker doesn't break)
#   - DNS resolution fails for a host -> log + skip that host
#
# CLAUDE.md §5 Rule 12 — iptables allowlist on Phase A (v2.2.x extends
# this from Node-only to Python/Go/Rust for parity).
set -eu

LOG_PREFIX="[allowlist]"
ALLOWLIST="${MENDEL_ALLOWLIST:-}"

apply_rules() {
  if ! command -v iptables >/dev/null 2>&1; then
    echo >&2 "$LOG_PREFIX iptables not installed - leaving bridge network open"
    return 0
  fi

  if [ -z "$ALLOWLIST" ]; then
    echo >&2 "$LOG_PREFIX MENDEL_ALLOWLIST empty - leaving bridge network open"
    return 0
  fi

  # Default-deny on OUTPUT. Flush first so re-runs don't accumulate.
  if ! iptables -F OUTPUT 2>/dev/null; then
    echo >&2 "$LOG_PREFIX iptables flush failed (no CAP_NET_ADMIN?) - leaving bridge open"
    return 0
  fi
  iptables -P OUTPUT DROP

  # Always allow loopback + established/related + DNS.
  iptables -A OUTPUT -o lo -j ACCEPT
  iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
  iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
  iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

  ALLOWED_COUNT=0
  for host in $ALLOWLIST; do
    ips=$(getent ahostsv4 "$host" 2>/dev/null | awk '{print $1}' | sort -u)
    if [ -z "$ips" ]; then
      echo >&2 "$LOG_PREFIX could not resolve $host - skipping"
      continue
    fi
    for ip in $ips; do
      iptables -A OUTPUT -d "$ip" -p tcp --dport 443 -j ACCEPT
      iptables -A OUTPUT -d "$ip" -p tcp --dport 80 -j ACCEPT
      ALLOWED_COUNT=$((ALLOWED_COUNT + 1))
    done
  done
  echo >&2 "$LOG_PREFIX allowlist applied - $ALLOWED_COUNT IP rule(s) ACCEPTED, default DROP"
}

apply_rules

# Drop privileges to mendel + exec. gosu is the debian-friendly equivalent
# of alpine's su-exec; we install it in each image's Dockerfile alongside
# iptables. If for some reason it's missing, fall back to `su -c`.
if command -v gosu >/dev/null 2>&1; then
  exec gosu mendel "$@"
else
  exec su -s /bin/sh mendel -c "$*"
fi
