FROM node:22-alpine

# Install pnpm directly — bypasses corepack version auto-detection
RUN npm install -g pnpm@9.0.0

# Install curl for egress-blocking verification in gate tests
RUN apk add --no-cache curl

WORKDIR /repo

# Use the pre-existing non-root `node` user (UID 1000) — required by CLAUDE.md §5
USER node

CMD ["sh"]
