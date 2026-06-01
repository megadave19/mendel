#!/usr/bin/env python3
"""
v2.2 / F23a — griffe semantic-diff for two PyPI versions.

Runs inside the mendel-python-sandbox Docker image. Installs the FROM and
TO versions of a package into separate temp dirs (using pip --target so we
don't pollute the venv), loads both with griffe, finds breaking changes,
and emits a JSON shape the TypeScript adapter normalizes into the existing
`SemanticDiff` schema.

Honest exit codes:
    0  diff produced (even if zero findings — pip + griffe both succeeded)
    1  unrecoverable error (pip install failed, griffe crashed, etc.) —
       stderr carries the cause. Caller treats this as the "could not
       analyze" path and reports the reason in `unanalyzableSymbols`.

Output shape (stdout, single JSON line on success):
    {
        "tier": "griffe",
        "removedExports":     ["pkg.module.Foo", ...],
        "signatureChanges":   [{"symbol": "...", "before": "...", "after": "..."}],
        "newDeprecations":    [],
        "unanalyzableSymbols": [{"symbol": "...", "reason": "..."}]
    }
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


def pip_install(pkg: str, version: str, target: Path) -> None:
    """Install <pkg>==<version> into a fresh prefix.

    `--no-deps` keeps the install lean (we only diff the package's OWN
    public surface, not its transitive deps' surfaces).
    """
    subprocess.run(
        [
            "pip", "install",
            "--no-deps",
            "--quiet",
            "--no-cache-dir",
            "--disable-pip-version-check",
            "--target", str(target),
            f"{pkg}=={version}",
        ],
        check=True,
        capture_output=True,
        text=True,
    )


def run_diff(pkg: str, from_v: str, to_v: str) -> dict[str, Any]:
    """Install both versions, load with griffe, return normalized findings."""
    # Import inside the function so a missing griffe shows as a clean
    # ImportError on stderr (caught by main) rather than blowing up at
    # script-load time.
    from griffe import GriffeLoader  # type: ignore[import-not-found]
    from griffe import find_breaking_changes  # type: ignore[import-not-found]

    out_removed: list[str] = []
    out_sig_changed: list[dict[str, str]] = []
    out_deprecations: list[str] = []
    out_unanalyzable: list[dict[str, str]] = []

    with tempfile.TemporaryDirectory(prefix=f"mendel-{pkg}-old-") as old_dir, \
         tempfile.TemporaryDirectory(prefix=f"mendel-{pkg}-new-") as new_dir:
        try:
            pip_install(pkg, from_v, Path(old_dir))
        except subprocess.CalledProcessError as e:
            raise RuntimeError(
                f"pip install {pkg}=={from_v} failed: {e.stderr[-500:]}"
            ) from e
        try:
            pip_install(pkg, to_v, Path(new_dir))
        except subprocess.CalledProcessError as e:
            raise RuntimeError(
                f"pip install {pkg}=={to_v} failed: {e.stderr[-500:]}"
            ) from e

        old_loader = GriffeLoader(search_paths=[old_dir])
        new_loader = GriffeLoader(search_paths=[new_dir])
        try:
            old_module = old_loader.load(pkg)
            new_module = new_loader.load(pkg)
        except Exception as e:  # noqa: BLE001 — griffe's load can throw many shapes
            raise RuntimeError(f"griffe load failed for {pkg}: {e}") from e

        # find_breaking_changes is a generator of `Breakage` objects.
        # We bucket by `.kind` (a string identifier in griffe ≥1.0).
        # https://mkdocstrings.github.io/griffe/reference/api/breakage/
        for b in find_breaking_changes(old_module, new_module):
            try:
                # griffe ≥1.0 returns Enum-style kinds like
                # `BreakageKind.OBJECT_REMOVED`; lowercase BEFORE bucketing
                # so our substring checks ("removed", "changed", etc.) hit.
                # Mistaken case-sensitive matching here in the first cut
                # dropped every cachetools-4→5 breakage into
                # `unanalyzableSymbols` — caught by the §11b.1 real-
                # container test against the live image.
                kind_raw = str(getattr(b, "kind", "") or "")
                kind = kind_raw.lower()
                path = str(getattr(b.obj, "path", "")) if getattr(b, "obj", None) else ""
            except Exception:  # noqa: BLE001 — never crash on an unusual breakage shape
                out_unanalyzable.append({"symbol": "<unknown>", "reason": "griffe breakage shape was not understood"})
                continue

            if not path:
                # Unusable record — log it honestly so the caller doesn't
                # silently lose the count.
                out_unanalyzable.append({"symbol": "<unknown>", "reason": f"griffe kind {kind_raw!r} without obj.path"})
                continue

            # Bucket by kind. The list of griffe breakage kinds is stable
            # across 1.x; we group rather than enumerate every single one
            # so future griffe additions don't silently drop into nothing.
            if "removed" in kind or "deleted" in kind:
                out_removed.append(path)
            elif "deprecat" in kind:
                out_deprecations.append(path)
            elif "changed" in kind or "type" in kind or "signature" in kind or "parameter" in kind:
                before = str(getattr(b, "old_value", "") or "")
                after = str(getattr(b, "new_value", "") or "")
                out_sig_changed.append({"symbol": path, "before": before, "after": after})
            else:
                # Unknown kind — surface it honestly rather than silently dropping.
                out_unanalyzable.append({"symbol": path, "reason": f"griffe kind {kind_raw!r} not bucketed by Mendel — please report"})

    return {
        "tier": "griffe",
        "removedExports": sorted(set(out_removed)),
        "signatureChanges": sorted(out_sig_changed, key=lambda d: d["symbol"]),
        "newDeprecations": sorted(set(out_deprecations)),
        "unanalyzableSymbols": out_unanalyzable,
    }


def main() -> int:
    if len(sys.argv) != 4:
        print(
            json.dumps({"error": "usage: griffe-diff PACKAGE FROM_VERSION TO_VERSION"}),
            file=sys.stderr,
        )
        return 1

    pkg, from_v, to_v = sys.argv[1], sys.argv[2], sys.argv[3]
    try:
        result = run_diff(pkg, from_v, to_v)
    except RuntimeError as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        return 1
    except Exception as e:  # noqa: BLE001 — last-resort guard so we always emit JSON
        print(json.dumps({"error": f"unexpected: {e!r}"}), file=sys.stderr)
        return 1

    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
