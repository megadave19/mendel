# v2.2 / F23a — Python sandbox image for the griffe-based semantic-diff.
#
# Mirrors the architectural decisions of docker/sandbox.Dockerfile:
#   - debian-slim base (python's official slim image; same glibc family as the
#     node image's follow-up plan, easier C-extension compatibility than alpine)
#   - non-root runtime user (CLAUDE.md §5 rule 11)
#   - tools we'll actually need pre-installed (git, build essentials for
#     C-extensions like numpy that some target deps require during pip install)
#   - griffe pinned to a known-major so a v3 release that breaks our adapter
#     can't silently mutate behavior (lockstep with V2_PLAN.md §F23a)
#
# This image is built on demand by lib/sandbox/python-executor.ts the first
# time a Python scan runs — same pattern as the node image. Image tag
# is `mendel-python-sandbox:v2.2`.

FROM python:3.13-slim

# git + build-essential cover the common cases when griffe needs to install
# a target package that has a C-extension component (numpy, lxml, etc.).
# Mendel pins griffe via pip pin below; system tooling is what's missing
# without these packages.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

# griffe is the analyzer. We pin to a major so a v2 release that changes the
# breakage shape doesn't silently land. `~=1.0` allows minor + patch updates
# only (V2_PLAN.md §F23a "real, shell-invokable tools per language" — the
# pin is the honesty knob).
#
# Layered separately from the system-package install so a griffe bump only
# rebuilds this layer + below (faster image rebuilds in CI).
RUN pip install --no-cache-dir 'griffe~=1.5'

# Non-root user: griffe runs untrusted code paths when it loads target
# packages, so we drop privileges (CLAUDE.md §5 rule 11, mirroring the
# node sandbox image which runs as `node` user).
RUN useradd --create-home --uid 1000 mendel

# The analysis script lives in /usr/local/bin so it's on PATH for the
# non-root user without copying into the user's home.
COPY python-griffe-diff.py /usr/local/bin/griffe-diff
RUN chmod +x /usr/local/bin/griffe-diff

# Default workdir for the sandboxed analysis. We write tarballs + install
# trees under /tmp inside the container — /workspace is reserved for any
# future host-bind use.
USER mendel
WORKDIR /workspace
