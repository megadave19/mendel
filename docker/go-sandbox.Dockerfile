## v2.2 / F23b sub-phase 2 — Go sandbox image.
##
## Provides:
##   - golang:1.22-bookworm (slim variant has too few CA certs for go get)
##   - git           (apidiff needs source — go get fetches via git)
##   - ca-certificates  (HTTPS to proxy.golang.org)
##   - apidiff       (golang.org/x/exp/cmd/apidiff, precompiled at build time)
##   - apidiff-diff  (Mendel's wrapper — sets up two throwaway modules,
##                    extracts API for each version, diffs them, emits
##                    JSON in the shape lib/sandbox/go-executor.ts expects)
##
## Non-root runtime user (CLAUDE.md §5 rule 11). Network mode is set at
## `docker run` time by lib/sandbox/go-executor.ts (`--network=bridge`)
## so apidiff can `go get` the two versions from proxy.golang.org.
##
## §11b.1 honored: tests/go-apidiff-container.test.ts asserts the image
## builds, apidiff lives on PATH for the non-root user, and a real PyPI-
## equivalent module pair runs through the wrapper end-to-end.

FROM golang:1.22-bookworm

# git + ca-certs are required for `go get` to fetch from the public
# proxy and to validate TLS against module hosts. bash is used by
# tests/scripts; the wrapper itself is a Go binary so it doesn't need
# bash, but having it available makes debugging via `docker run -it`
# vastly more pleasant.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        ca-certificates \
        bash \
        iptables \
        gosu \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Install apidiff. We DELIBERATELY allow Go to auto-fetch a newer
# toolchain at build time (GOTOOLCHAIN=auto) because golang.org/x/exp
# now requires Go ≥ 1.25, which is newer than the base image's 1.22.
# The image-build pull is one-time + cached. The §11b.1 real-container
# test pins runtime behavior — if a future apidiff release changes
# output shape, that test fails on the next image build and we
# investigate rather than shipping silently-broken bucketing.
ENV GOTOOLCHAIN=auto
RUN go install golang.org/x/exp/cmd/apidiff@latest

# Mendel's wrapper. Built as a single static binary at image-build time
# so the runtime container starts immediately and there's no go.mod or
# GOPATH state to manage outside the throwaway module dirs the wrapper
# itself creates.
COPY go-apidiff-diff.go /tmp/wrapper/main.go
RUN cd /tmp/wrapper \
    && go mod init apidiff-diff >/dev/null 2>&1 \
    && CGO_ENABLED=0 go build -o /usr/local/bin/apidiff-diff main.go \
    && rm -rf /tmp/wrapper

# Non-root runtime user. apidiff + go get + the wrapper all work
# entirely from $HOME + /tmp under uid 1000.
RUN useradd --create-home --uid 1000 mendel

# Make /go writable for mendel — `go get` writes to /go/pkg/sumdb (the
# Go checksum-database mirror cache) and /go/pkg/mod (downloaded module
# sources). Without this, `go get` fails with "permission denied" inside
# the container — a class of error the §11b.1 real-container test
# caught immediately on the first viper diff attempt.
RUN mkdir -p /go/pkg/mod /go/pkg/sumdb && chown -R mendel:mendel /go

# Make sure both apidiff (installed into /go/bin) and apidiff-diff
# (installed into /usr/local/bin) are discoverable to the runtime user.
ENV PATH="/go/bin:/usr/local/bin:${PATH}"
ENV GOPATH=/go
ENV GOCACHE=/tmp/.go-cache
ENV GOMODCACHE=/tmp/.go-mod-cache

# v2.2.x polish — iptables allowlist entrypoint (CLAUDE.md §5 r12).
# Runs as root briefly to apply iptables rules from MENDEL_ALLOWLIST,
# then drops to mendel via gosu. Empty allowlist OR no CAP_NET_ADMIN
# → leaves bridge open (back-compat for dev).
COPY setup-allowlist-debian.sh /usr/local/bin/setup-allowlist.sh
RUN chmod +x /usr/local/bin/setup-allowlist.sh

# NOTE: USER directive removed — entrypoint needs root for iptables and
# drops to mendel via gosu. End-state runtime user is identical.
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/setup-allowlist.sh"]
