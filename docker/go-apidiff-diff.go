// v2.2 / F23b sub-phase 2 — apidiff wrapper for the Go sandbox.
//
// Runs inside mendel-go-sandbox. Takes (module-path, from-version,
// to-version), sets up two throwaway modules, fetches each version via
// `go get`, extracts the API surface with `apidiff -w`, then diffs the
// two API snapshots with `apidiff <old> <new>`. Parses the textual diff
// output and emits a JSON shape lib/sandbox/go-executor.ts normalizes
// into the shared `SemanticDiff`.
//
// Honest exit codes:
//
//	0  diff produced (even if zero findings — every command succeeded)
//	1  unrecoverable error (go get failed, apidiff crashed, etc.) —
//	   stderr carries the cause. The Go adapter treats this as the
//	   "could not analyze" path and reports the reason in
//	   unanalyzableSymbols.
//
// Output shape (stdout, single JSON line on success):
//
//	{
//	  "tier": "apidiff",
//	  "removedExports":     ["pkg.Foo", ...],
//	  "signatureChanges":   [{"symbol": "...", "before": "...", "after": "..."}],
//	  "newDeprecations":    [],
//	  "unanalyzableSymbols": [{"symbol": "...", "reason": "..."}]
//	}
//
// Scope: this wrapper handles SINGLE-PACKAGE modules — it treats the
// module path as the import path. Multi-package modules (`module/...`)
// would require enumerating packages via `go list`, diffing each, and
// merging — tracked as a v2.2.x follow-on. When the wrapper can't
// resolve the module-as-package, it surfaces the failure honestly
// instead of pretending no breaking changes were found (§5b).
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

// ── Output shape ──────────────────────────────────────────────────────────────

type sigChange struct {
	Symbol string `json:"symbol"`
	Before string `json:"before"`
	After  string `json:"after"`
}

type unanalyzable struct {
	Symbol string `json:"symbol"`
	Reason string `json:"reason"`
}

type output struct {
	Tier                string         `json:"tier"`
	RemovedExports      []string       `json:"removedExports"`
	SignatureChanges    []sigChange    `json:"signatureChanges"`
	NewDeprecations     []string       `json:"newDeprecations"`
	UnanalyzableSymbols []unanalyzable `json:"unanalyzableSymbols"`
}

func main() {
	if len(os.Args) != 4 {
		failf("usage: apidiff-diff MODULE FROM_VERSION TO_VERSION")
	}
	module := os.Args[1]
	fromV := normalizeVersion(os.Args[2])
	toV := normalizeVersion(os.Args[3])

	// Stage two throwaway modules. We DELIBERATELY do not reuse one
	// directory + `go get module@from`, `go get module@to` — that
	// would overwrite the first version's source in the module cache
	// (well, share the same cache entry; the second go-get pinning
	// changes go.mod). Two separate dirs is the simplest correct path.
	v1Dir, err := os.MkdirTemp("", "mendel-go-v1-")
	if err != nil {
		failf("mkdtemp v1: %v", err)
	}
	defer os.RemoveAll(v1Dir)

	v2Dir, err := os.MkdirTemp("", "mendel-go-v2-")
	if err != nil {
		failf("mkdtemp v2: %v", err)
	}
	defer os.RemoveAll(v2Dir)

	if err := setupModule(v1Dir, module, fromV); err != nil {
		failf("install %s@%s: %v", module, fromV, err)
	}
	if err := setupModule(v2Dir, module, toV); err != nil {
		failf("install %s@%s: %v", module, toV, err)
	}

	apiFile1 := filepath.Join(v1Dir, "api.txt")
	apiFile2 := filepath.Join(v2Dir, "api.txt")
	if err := extractAPI(v1Dir, module, apiFile1); err != nil {
		failf("apidiff -w (%s): %v", fromV, err)
	}
	if err := extractAPI(v2Dir, module, apiFile2); err != nil {
		failf("apidiff -w (%s): %v", toV, err)
	}

	// Final diff. `-m` matches the `-m -w` we used to extract — apidiff
	// requires the diff and the writes to be in the same mode (module vs
	// package). apidiff exits 0 EVEN WHEN it finds incompatible changes
	// (those go to stdout). A non-zero exit means apidiff itself crashed
	// — we surface that as a hard error so the adapter falls back honestly.
	diffOut, err := runCmd("", "apidiff", "-m", apiFile1, apiFile2)
	if err != nil {
		failf("apidiff diff: %v (output: %s)", err, lastN(diffOut, 400))
	}

	out := parseApidiffOutput(diffOut)
	out.Tier = "apidiff"

	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(out); err != nil {
		failf("emit json: %v", err)
	}
}

// ── Module setup + extraction ────────────────────────────────────────────────

// normalizeVersion ensures the version string carries the `v` prefix Go
// requires. Allows callers to pass either `1.2.3` or `v1.2.3`.
func normalizeVersion(v string) string {
	if strings.HasPrefix(v, "v") {
		return v
	}
	return "v" + v
}

// setupModule creates a throwaway module in `dir`, runs `go mod init temp`,
// then `go get <module>@<version>` to fetch the source into the shared
// module cache. We pass `-mod=mod` via GOFLAGS so go get is allowed to
// modify go.mod in this throwaway context.
func setupModule(dir, module, version string) error {
	if _, err := runCmd(dir, "go", "mod", "init", "temp"); err != nil {
		return fmt.Errorf("go mod init: %w", err)
	}
	// `go get` in module mode. GOFLAGS=-mod=mod lets it update go.mod
	// freely (the default `-mod=readonly` would refuse).
	cmd := exec.Command("go", "get", module+"@"+version)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GOFLAGS=-mod=mod")
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("go get %s@%s: %w: %s", module, version, err, lastN(string(out), 400))
	}
	return nil
}

// extractAPI runs `apidiff -m -w outFile <module>` from a directory whose
// go.mod requires `module`. The `-m` flag tells apidiff to operate on a
// MODULE (not a single package) — required so the diff covers the entire
// public surface, not just the root-import-path's package. apidiff
// resolves the module via the local go.mod and writes a binary API
// snapshot to `outFile`. The §11b.1 test caught the missing `-m` flag
// on first try (apidiff without `-m` returned "found no packages").
func extractAPI(dir, module, outFile string) error {
	if _, err := runCmd(dir, "apidiff", "-m", "-w", outFile, module); err != nil {
		return fmt.Errorf("apidiff -m -w: %w", err)
	}
	return nil
}

// ── Parser ───────────────────────────────────────────────────────────────────

// apidiff output format (`go doc golang.org/x/exp/cmd/apidiff`):
//
//	Incompatible changes:
//	- pkg.Foo: removed
//	- pkg.T: changed from old-signature to new-signature
//	- (Compatible changes omitted)
//
// We bucket the incompatible-changes section: ` removed` → removedExports;
// ` changed from X to Y` → signatureChanges; anything else within the
// incompatible block lands in unanalyzableSymbols so a future apidiff
// release that adds a new line shape fails LOUDLY, not silently (§5b).

var (
	removedLine = regexp.MustCompile(`^-\s*(.+?):\s*removed$`)
	changedLine = regexp.MustCompile(`^-\s*(.+?):\s*changed from\s+(.+?)\s+to\s+(.+)$`)
	anyLine     = regexp.MustCompile(`^-\s*(.+)$`)
)

func parseApidiffOutput(text string) output {
	out := output{
		RemovedExports:      []string{},
		SignatureChanges:    []sigChange{},
		NewDeprecations:     []string{},
		UnanalyzableSymbols: []unanalyzable{},
	}

	scanner := bufio.NewScanner(strings.NewReader(text))
	// apidiff lines can be long for verbose signature changes; raise the
	// scanner buffer cap from the 64KB default to be safe.
	const maxLine = 1024 * 1024
	scanner.Buffer(make([]byte, 0, 64*1024), maxLine)

	inIncompat := false
	for scanner.Scan() {
		line := scanner.Text()
		if line == "Incompatible changes:" {
			inIncompat = true
			continue
		}
		if line == "Compatible changes:" {
			inIncompat = false
			continue
		}
		if !inIncompat {
			continue
		}
		if m := removedLine.FindStringSubmatch(line); m != nil {
			out.RemovedExports = append(out.RemovedExports, strings.TrimSpace(m[1]))
			continue
		}
		if m := changedLine.FindStringSubmatch(line); m != nil {
			out.SignatureChanges = append(out.SignatureChanges, sigChange{
				Symbol: strings.TrimSpace(m[1]),
				Before: strings.TrimSpace(m[2]),
				After:  strings.TrimSpace(m[3]),
			})
			continue
		}
		// Unbucketed `- foo` line. Surface honestly — never silently drop.
		if m := anyLine.FindStringSubmatch(line); m != nil {
			out.UnanalyzableSymbols = append(out.UnanalyzableSymbols, unanalyzable{
				Symbol: strings.TrimSpace(m[1]),
				Reason: "apidiff incompatible-change line not recognized by Mendel's bucketer — please report",
			})
		}
	}
	return out
}

// ── Small utilities ──────────────────────────────────────────────────────────

func runCmd(dir, name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	if dir != "" {
		cmd.Dir = dir
	}
	out, err := cmd.CombinedOutput()
	return string(out), err
}

func lastN(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[len(s)-n:]
}

func failf(format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	enc := json.NewEncoder(os.Stderr)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(map[string]string{"error": msg})
	os.Exit(1)
}
