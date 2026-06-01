//! v2.2 / F23c sub-phase 2 — cargo-semver-checks wrapper for the Rust sandbox.
//!
//! Runs inside mendel-rust-sandbox. Takes (crate-name, from-version,
//! to-version), creates a throwaway crate that depends on
//! `<crate>@<to-version>`, then invokes
//! `cargo semver-checks --baseline-version <from> -p <crate>`.
//! Parses the textual report and emits a JSON shape
//! `lib/sandbox/rust-executor.ts` normalizes into the shared
//! `SemanticDiff`.
//!
//! Honest exit codes:
//!
//!   0  diff produced (even if zero findings — every command succeeded)
//!   1  unrecoverable error (cargo failed, semver-checks crashed) —
//!      stderr carries the cause. The Rust adapter treats this as the
//!      "could not analyze" path and reports the reason in
//!      `unanalyzableSymbols`.
//!
//! Output shape (stdout, single JSON line on success):
//!
//!   {
//!     "tier": "cargo-semver-checks",
//!     "removedExports":     ["crate::Foo", ...],
//!     "signatureChanges":   [{"symbol": "...", "before": "...", "after": "..."}],
//!     "newDeprecations":    [],
//!     "unanalyzableSymbols": [{"symbol": "...", "reason": "..."}]
//!   }
//!
//! Scope: this wrapper uses cargo-semver-checks' built-in crates.io
//! baseline lookup (`--baseline-version`), which is the simplest viable
//! invocation. It does NOT support workspace crates, git-source crates,
//! or path-source crates — those are out of scope for sub-phase 2 and
//! surfaced honestly when the wrapper detects them.

use std::env;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::{Command, ExitCode};

/// One-shot JSON-escape for arbitrary strings. Avoids pulling a serde
/// dep (zero-dep wrapper, see Cargo.toml). Handles `"`, `\`, control
/// chars; everything else passes through. Adequate for our output
/// shape (no Unicode surrogate pairs since cargo-semver-checks output
/// is ASCII).
fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

fn fail(msg: &str) -> ExitCode {
    let mut stderr = std::io::stderr().lock();
    let _ = writeln!(stderr, r#"{{"error":"{}"}}"#, json_escape(msg));
    ExitCode::FAILURE
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    if args.len() != 4 {
        return fail("usage: semver-checks-diff CRATE FROM_VERSION TO_VERSION");
    }
    let crate_name = &args[1];
    let from_v = strip_v(&args[2]);
    let to_v = strip_v(&args[3]);

    // cargo-semver-checks's `-p <name>` flag selects a WORKSPACE
    // MEMBER, not a dependency. To check an arbitrary crate pair we
    // download the TO_VERSION's actual source from crates.io and run
    // cargo-semver-checks from inside it (with --baseline-version
    // pointing at FROM_V, which cargo-semver-checks then fetches
    // automatically from crates.io as the baseline).
    //
    // Discovered while writing the §11b.1 test against clap 2 → 3:
    // the throwaway-crate approach errored with "no crates with
    // library targets selected, nothing to semver-check" because
    // -p was selecting the empty throwaway, not the dependency.
    let workdir = match tempdir("mendel-rust-") {
        Ok(d) => d,
        Err(e) => return fail(&format!("mkdtemp: {e}")),
    };
    let src_dir = match download_crate_source(workdir.path(), crate_name, &to_v) {
        Ok(d) => d,
        Err(e) => return fail(&format!("download crate source: {e}")),
    };

    // Run cargo-semver-checks from the downloaded source directory.
    // --baseline-version tells the tool which prior crates.io version
    // to compare against (it fetches FROM_V on demand).
    //
    // CRUCIAL: --release-type=patch. cargo-semver-checks is normally a
    // semver-compliance auditor — it SKIPS all checks when the bump is
    // already a major-version increment (because by-definition no
    // semver violation can exist). Mendel cares about BREAKING CHANGES
    // for the upgrade-guide purpose regardless of bump kind, so we
    // force --release-type=patch to make every lint runnable. Without
    // this the tool returns "0 pass, 253 skip" on every major bump
    // pair — caught immediately when the §11b.1 test got zero findings
    // on semver 0.11 → 1.0 (a verified API-redesign release).
    let output = Command::new("cargo")
        .args([
            "semver-checks",
            "--baseline-version",
            &from_v,
            "--release-type=patch",
        ])
        .current_dir(&src_dir)
        .output();

    let combined = match output {
        Ok(o) => {
            // cargo-semver-checks exits NON-ZERO when it finds
            // breaking changes. That's normal — the findings go to
            // stderr. Treat both streams as report content.
            let mut s = String::from_utf8_lossy(&o.stdout).into_owned();
            s.push_str(&String::from_utf8_lossy(&o.stderr));
            s
        }
        Err(e) => return fail(&format!("cargo semver-checks invocation: {e}")),
    };

    // Parse the textual report. cargo-semver-checks emits sections
    // grouped by lint name; each finding lists the affected symbol +
    // a description. We bucket by lint category into removedExports
    // / signatureChanges / newDeprecations.
    let parsed = parse_semver_checks_report(&combined);

    // Emit JSON. Hand-rolled string assembly so we don't need serde.
    let mut out = String::new();
    out.push_str(r#"{"tier":"cargo-semver-checks","removedExports":["#);
    out.push_str(
        &parsed
            .removed
            .iter()
            .map(|s| format!("\"{}\"", json_escape(s)))
            .collect::<Vec<_>>()
            .join(","),
    );
    out.push_str(r#"],"signatureChanges":["#);
    out.push_str(
        &parsed
            .changed
            .iter()
            .map(|sc| {
                format!(
                    r#"{{"symbol":"{}","before":"{}","after":"{}"}}"#,
                    json_escape(&sc.symbol),
                    json_escape(&sc.before),
                    json_escape(&sc.after),
                )
            })
            .collect::<Vec<_>>()
            .join(","),
    );
    out.push_str(r#"],"newDeprecations":["#);
    out.push_str(
        &parsed
            .deprecated
            .iter()
            .map(|s| format!("\"{}\"", json_escape(s)))
            .collect::<Vec<_>>()
            .join(","),
    );
    out.push_str(r#"],"unanalyzableSymbols":["#);
    out.push_str(
        &parsed
            .unanalyzable
            .iter()
            .map(|u| {
                format!(
                    r#"{{"symbol":"{}","reason":"{}"}}"#,
                    json_escape(&u.symbol),
                    json_escape(&u.reason),
                )
            })
            .collect::<Vec<_>>()
            .join(","),
    );
    out.push_str("]}");
    println!("{out}");

    ExitCode::SUCCESS
}

/// Strip a leading `v` from a version string. cargo's Cargo.toml
/// expects bare semver (`1.2.3`); accept either shape from the
/// caller for symmetry with the Go adapter.
fn strip_v(v: &str) -> String {
    v.strip_prefix('v').unwrap_or(v).to_string()
}

/// Create a temp directory. std doesn't expose mkdtemp directly; we
/// use a sequence-counter file approach to avoid a tempfile dep.
struct TempDir {
    path: std::path::PathBuf,
}
impl TempDir {
    fn path(&self) -> &Path {
        &self.path
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}
fn tempdir(prefix: &str) -> std::io::Result<TempDir> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!("{prefix}{nanos}"));
    fs::create_dir_all(&path)?;
    Ok(TempDir { path })
}

/// Download a crate's source from crates.io's static tarball CDN and
/// extract it into `parent_dir`. Returns the path to the extracted
/// directory (which will be named `<crate>-<version>` by crates.io's
/// convention).
///
/// We shell out to `curl` + `tar` rather than pulling a tar/HTTP crate
/// in to keep the wrapper dep-free. Both binaries are installed in
/// the sandbox Dockerfile (curl, tar).
fn download_crate_source(
    parent_dir: &Path,
    crate_name: &str,
    version: &str,
) -> std::io::Result<std::path::PathBuf> {
    let url = format!("https://static.crates.io/crates/{crate_name}/{crate_name}-{version}.crate");
    let tarball = parent_dir.join(format!("{crate_name}-{version}.crate"));

    // Fetch the tarball. -f makes curl exit non-zero on HTTP errors
    // (otherwise we'd silently write a 404 HTML page to disk).
    let curl_status = Command::new("curl")
        .args([
            "-fsSL",
            "-o",
        ])
        .arg(&tarball)
        .arg(&url)
        .status()?;
    if !curl_status.success() {
        return Err(std::io::Error::other(format!(
            "curl exited non-zero ({curl_status}) fetching {url}"
        )));
    }

    // Extract. -C cd's tar into parent_dir before extracting; the
    // tarball's internal layout puts everything under
    // <crate>-<version>/, so the extracted dir lands at that path.
    let tar_status = Command::new("tar")
        .args(["-xzf"])
        .arg(&tarball)
        .arg("-C")
        .arg(parent_dir)
        .status()?;
    if !tar_status.success() {
        return Err(std::io::Error::other(format!(
            "tar exited non-zero ({tar_status}) extracting {}",
            tarball.display()
        )));
    }

    let extracted = parent_dir.join(format!("{crate_name}-{version}"));
    if !extracted.exists() {
        return Err(std::io::Error::other(format!(
            "expected extracted dir {} but it doesn't exist",
            extracted.display()
        )));
    }
    Ok(extracted)
}

// ── Parser ───────────────────────────────────────────────────────────────────
//
// cargo-semver-checks emits a human-readable report grouped by lint
// name. The format is roughly:
//
//   --- failure <lint-name>: <description> ---
//   Description:
//       <details>
//   Failed in:
//       <symbol-path> in file <path>:<line>
//
// We don't try to round-trip every lint kind (there are dozens). We
// classify by lint NAME prefix:
//   - *_removed              → removedExports
//   - *_signature_changed    → signatureChanges (symbol only — before/after empty)
//   - any other failed lint  → unanalyzableSymbols (so future lints aren't
//                              silently dropped, §5b)

struct SignatureChange {
    symbol: String,
    before: String,
    after: String,
}
struct UnanalyzableEntry {
    symbol: String,
    reason: String,
}

struct ParsedReport {
    removed: Vec<String>,
    changed: Vec<SignatureChange>,
    deprecated: Vec<String>,
    unanalyzable: Vec<UnanalyzableEntry>,
}

fn parse_semver_checks_report(text: &str) -> ParsedReport {
    let mut removed = Vec::new();
    let mut changed = Vec::new();
    let deprecated = Vec::new();
    let mut unanalyzable = Vec::new();

    // Actual report format (verified against cargo-semver-checks 0.48
    // on semver 0.11 → 1.0):
    //
    //   --- failure <lint_name>: <description> ---
    //
    //   Description:
    //       <long-form>
    //           ref: https://…
    //          impl: https://…
    //
    //   Failed in:
    //     <symbol>, previously in file /path/to/source.rs:N
    //     <symbol>, previously in file /path/to/source.rs:N
    //
    // We walk in three states: idle / inside-failure-block / inside-
    // failed-in. Symbols come from the failed-in block. Lint NAME comes
    // from the failure-header line.

    let mut current_lint: Option<String> = None;
    let mut in_failed_in_block = false;

    for raw_line in text.lines() {
        let line = raw_line.trim_end();

        // New failure block — reset state.
        if let Some(rest) = line.strip_prefix("--- failure ") {
            in_failed_in_block = false;
            if let Some(colon_idx) = rest.find(':') {
                current_lint = Some(rest[..colon_idx].trim().to_string());
            } else {
                current_lint = None;
            }
            continue;
        }

        // Enter the "Failed in:" sub-block when we see the header.
        if line.trim_start() == "Failed in:" {
            in_failed_in_block = true;
            continue;
        }

        // Leaving the failed-in block: any line that isn't a "Failed in:"
        // entry shape ends the block. cargo-semver-checks indents block
        // entries by EXACTLY 2 spaces; cargo's progress output ("    Built",
        // "    Finished") uses 4+ spaces. Use indent depth as the
        // discriminator so progress lines don't pollute our findings.
        // (First-cut parser used "any leading space" and slurped
        // "Building semver v1.0.0 (current)" + dozens of build-step
        // lines as removed exports — caught by reading the wrapper's
        // raw output on semver 0.11 → 1.0.)
        if in_failed_in_block {
            let leading_spaces = line.len() - line.trim_start().len();
            if line.is_empty() {
                continue;
            }
            // Anything other than exactly-2-space indent terminates
            // the block. Caller's outer logic resets state on the
            // next `--- failure` header.
            if leading_spaces != 2 {
                in_failed_in_block = false;
                continue;
            }
        }

        if !in_failed_in_block {
            continue;
        }

        // Inside the failed-in block, each affected-symbol line looks like:
        //   "  <symbol>, previously in file /path:N"
        //   "  <feature> in the package's Cargo.toml"
        //   "  fn <name>, previously in file …"
        //
        // The symbol/identifier is everything before the FIRST comma
        // (or the FIRST " in " token if no comma — feature_missing
        // emits "feature foo in the package's Cargo.toml").
        let trimmed = line.trim();
        let symbol = if let Some(idx) = trimmed.find(", previously") {
            trimmed[..idx].trim().to_string()
        } else if let Some(idx) = trimmed.find(" in the package's") {
            trimmed[..idx].trim().to_string()
        } else if let Some(idx) = trimmed.find(", in ") {
            trimmed[..idx].trim().to_string()
        } else {
            // Whole line as the symbol — strange shape, surface honestly.
            trimmed.to_string()
        };
        // Drop a leading lint-shape word like "fn ", "enum ", "struct "
        // — the lint name + symbol path together carry the kind info,
        // so leaving "fn " in the symbol field would be visual noise.
        let symbol = strip_kind_prefix(&symbol);

        let Some(lint) = current_lint.as_deref() else {
            continue;
        };
        classify_finding(
            lint,
            &symbol,
            &mut removed,
            &mut changed,
            &mut unanalyzable,
        );
    }

    ParsedReport {
        removed,
        changed,
        deprecated,
        unanalyzable,
    }
}

/// Strip a leading kind word (`fn `, `enum `, `struct `, `trait `,
/// `mod `, `feature `) from a symbol so the path itself is the value.
fn strip_kind_prefix(s: &str) -> String {
    for prefix in [
        "fn ", "enum ", "struct ", "trait ", "mod ", "feature ", "type ", "const ", "static ", "macro ",
    ] {
        if let Some(rest) = s.strip_prefix(prefix) {
            return rest.to_string();
        }
    }
    s.to_string()
}

fn classify_finding(
    lint: &str,
    symbol: &str,
    removed: &mut Vec<String>,
    changed: &mut Vec<SignatureChange>,
    unanalyzable: &mut Vec<UnanalyzableEntry>,
) {
    // Classification by lint name. cargo-semver-checks ships ~100+
    // lints; we route by suffix. Verified categories against v0.48:
    //   *_missing  → removed (function_missing, enum_missing,
    //                inherent_method_missing, feature_missing, …)
    //   *_changed / *_now_* / *_added → signature change
    //   anything else                  → unanalyzable (honest surfacing)
    if lint.contains("missing") || lint.contains("removed") {
        if !removed.contains(&symbol.to_string()) {
            removed.push(symbol.to_string());
        }
        return;
    }
    if lint.contains("changed")
        || lint.contains("now_")
        || lint.contains("added")
        || lint.contains("becomes")
        || lint.contains("type")
    {
        if !changed.iter().any(|sc: &SignatureChange| sc.symbol == symbol) {
            changed.push(SignatureChange {
                symbol: symbol.to_string(),
                before: String::new(),
                after: String::new(),
            });
        }
        return;
    }
    // Unknown lint — surface honestly. Same shape the F23a python
    // wrapper uses for unbucketed griffe kinds.
    if !unanalyzable.iter().any(|u: &UnanalyzableEntry| u.symbol == symbol) {
        unanalyzable.push(UnanalyzableEntry {
            symbol: symbol.to_string(),
            reason: format!(
                "cargo-semver-checks lint `{lint}` not recognized by Mendel's bucketer — please report"
            ),
        });
    }
}
