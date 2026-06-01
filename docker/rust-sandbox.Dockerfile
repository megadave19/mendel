## v2.2 / F23c sub-phase 2 — Rust sandbox image.
##
## Provides:
##   - rust:1-slim (current stable)
##   - cargo + cargo-semver-checks (precompiled at build time)
##   - rustup nightly toolchain (rustdoc JSON requires nightly)
##   - git + ca-certificates (cargo fetches via git/HTTPS)
##   - semver-checks-diff (Mendel's wrapper — sets up a throwaway crate
##                         that depends on <CRATE>@<TO>, generates rustdoc
##                         JSON for both FROM and TO versions, runs
##                         cargo-semver-checks with --baseline-rustdoc, and
##                         parses the textual output into JSON in the shape
##                         lib/sandbox/rust-executor.ts expects)
##
## Non-root runtime user (CLAUDE.md §5 rule 11). Network mode is set at
## `docker run` time by lib/sandbox/rust-executor.ts (`--network=bridge`)
## so the wrapper can fetch both crate versions from crates.io.
##
## §11b.1 honored: tests/rust-semver-checks-container.test.ts asserts
## the image builds, cargo-semver-checks lives on PATH for the non-root
## user, and a real public crate pair runs through the wrapper end-to-end.

FROM rust:1-slim

# git + ca-certs are required for cargo to fetch dependencies from
# crates.io / git. build-essential covers any crate that has C-extension
# build.rs steps. We pin the package-list snapshot via apt-get update +
# install in the same layer for reproducible builds.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        ca-certificates \
        build-essential \
        pkg-config \
        cmake \
        curl \
        tar \
    && rm -rf /var/lib/apt/lists/*

# Install cargo-semver-checks. We track the latest released version
# rather than a tight pin because cargo-semver-checks must keep pace
# with rustdoc JSON format bumps (rust 1.78+ produces a v57 rustdoc
# JSON that 0.36 can't parse; current cargo-semver-checks ≥ 0.43
# supports it). The §11b.1 real-container test pins runtime behavior
# — if a future cargo-semver-checks release changes output shape,
# that test fails on the next image build and we investigate rather
# than shipping silently-broken bucketing.
RUN cargo install --locked cargo-semver-checks

# Install nightly toolchain for rustdoc JSON generation. cargo-semver-
# checks needs rustdoc JSON output, which is a nightly-only -Z flag.
# We don't make nightly the default — stable stays default for normal
# cargo operations; the wrapper explicitly invokes nightly when needed.
RUN rustup install nightly --profile minimal \
    && rustup component add --toolchain nightly rust-src

# Mendel's wrapper. Built as a single static binary at image-build time
# so the runtime container starts immediately. Compiled with stable.
COPY rust-semver-checks-diff.rs /tmp/wrapper/src/main.rs
COPY rust-semver-checks-diff.Cargo.toml /tmp/wrapper/Cargo.toml
RUN cd /tmp/wrapper \
    && cargo build --release \
    && cp target/release/semver-checks-diff /usr/local/bin/semver-checks-diff \
    && rm -rf /tmp/wrapper

# Non-root runtime user. cargo + rustup + the wrapper all work from
# $HOME + /tmp under uid 1000.
RUN useradd --create-home --uid 1000 mendel

# Make CARGO_HOME + RUSTUP_HOME writable for mendel — cargo writes to
# $CARGO_HOME/registry on first fetch and rustup writes to
# $RUSTUP_HOME/toolchains. Without this, the non-root user gets
# "permission denied" on the first `cargo add` — the same class of bug
# the F23b §11b.1 test caught with /go/pkg/sumdb.
ENV CARGO_HOME=/tmp/.cargo
ENV RUSTUP_HOME=/usr/local/rustup
RUN chown -R mendel:mendel /usr/local/rustup /usr/local/cargo

# Ensure both cargo-semver-checks (installed into $CARGO_HOME/bin during
# the build phase, i.e. /usr/local/cargo/bin) and semver-checks-diff
# (/usr/local/bin) are discoverable to the runtime user.
ENV PATH="/usr/local/cargo/bin:/usr/local/bin:${PATH}"

USER mendel
WORKDIR /workspace
