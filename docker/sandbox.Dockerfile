FROM node:22-alpine

# Install pnpm directly — bypasses corepack version auto-detection
RUN npm install -g pnpm@9.0.0

# - curl: egress-blocking verification in gate tests
# - iptables: v1.5 W#8 default-deny allowlist on Phase A (CLAUDE.md §5 Rule 12)
# - su-exec: drop privileges from root → node after allowlist applies
# - bind-tools: getent ahostsv4 for hostname-to-IP resolution in the entrypoint
RUN apk add --no-cache curl iptables su-exec bind-tools

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
