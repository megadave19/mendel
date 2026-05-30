FROM node:22-alpine

# Install pnpm + yarn directly — bypasses corepack version auto-detection.
# `--force` is required: node:22-alpine pre-installs corepack shims at
# /usr/local/bin/yarn (and friends), so a plain `npm install -g yarn` fails
# with EEXIST. The flag tells npm to overwrite the shim with the pinned binary.
# yarn is REQUIRED: yarn-lockfile repos (e.g. ta-vivo) detect `yarn install`,
# and without the binary Phase A failed instantly ("yarn: not found") → every
# yarn repo silently failed verification → confidence capped → no PR. (npm
# ships with the node base image; pnpm + yarn cover the other two managers.)
RUN npm install -g --force pnpm@9.0.0 yarn@1.22.22

# - curl: egress-blocking verification in gate tests
# - iptables: v1.5 W#8 default-deny allowlist on Phase A (CLAUDE.md §5 Rule 12)
# - su-exec: drop privileges from root → node after allowlist applies
# - bind-tools: getent ahostsv4 for hostname-to-IP resolution in the entrypoint
# - git: git-based dependencies + some install scripts need it (was missing →
#   silent Phase A failures)
# - python3 + build-base: node-gyp native-module compilation (sharp,
#   better-sqlite3, etc.) — without these, any repo with a native dep failed to
#   install. (Note: alpine/musl still can't run some glibc prebuilt binaries;
#   a debian-slim base would close that remaining gap — tracked as a follow-up.)
RUN apk add --no-cache curl iptables su-exec bind-tools git python3 build-base

# Entrypoint runs as root, applies the iptables allowlist, then drops to the
# non-root node user (UID 1000) for the actual install command. CLAUDE.md §5
# Rule 11/12: ephemeral, non-root for the workload, hardened.
COPY setup-allowlist.sh /usr/local/bin/setup-allowlist.sh
RUN chmod +x /usr/local/bin/setup-allowlist.sh

WORKDIR /repo

# NOTE: no USER directive — entrypoint script runs as root briefly (CAP_NET_ADMIN
# required to manipulate iptables), then exec's as `node` user via su-exec.
# Without CAP_NET_ADMIN the script logs + falls back to open bridge so dev
# environments without privileged docker still work.

ENTRYPOINT ["/usr/local/bin/setup-allowlist.sh"]
CMD ["sh"]
