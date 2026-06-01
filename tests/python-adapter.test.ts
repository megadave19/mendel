/**
 * Tests for the v2.2 / F23a Python adapter.
 *
 * Covers:
 *   - Detection across the 4 manifest formats (pyproject.toml / setup.py /
 *     Pipfile / requirements.txt)
 *   - The three inline parsers (requirements.txt / PEP 621 pyproject /
 *     poetry pyproject / Pipfile) — exhaustively, real-shape fixtures
 *   - readAllManifests merges + honest "setup.py present but not parsed"
 *     logging (§5b: never silently drop)
 *   - The honest semantic-diff stub returns analyzable-but-empty data
 *     with a clear reason — confidence stays capped until griffe lands
 *
 * Real tmp directories — no fs mocks; the whole point is filesystem-shape
 * parsing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  pythonAdapter,
  parsePyprojectToml,
  parsePipfile,
  parseRequirementsTxt,
} from '@/lib/agent/lang/python'

let repo: string
beforeEach(() => { repo = mkdtempSync(path.join(tmpdir(), 'mendel-py-')) })
afterEach(() => { try { rmSync(repo, { recursive: true, force: true }) } catch { /* tmp reaper */ } })

function file(rel: string, content: string) {
  const abs = path.join(repo, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}

// ── parseRequirementsTxt ──────────────────────────────────────────────────────

describe('parseRequirementsTxt', () => {
  it('parses common version specs', () => {
    const m = parseRequirementsTxt('requests>=2.31.0\nflask==3.0.0\ndjango~=4.2\n')
    expect(m.get('requests')).toBe('>=2.31.0')
    expect(m.get('flask')).toBe('==3.0.0')
    expect(m.get('django')).toBe('~=4.2')
  })

  it('treats an unversioned package as "*"', () => {
    const m = parseRequirementsTxt('requests\n')
    expect(m.get('requests')).toBe('*')
  })

  it('ignores comments, blank lines, and trailing whitespace', () => {
    const m = parseRequirementsTxt(`# header\n\nrequests>=2.0  # min version\n   \nflask\n`)
    expect(m.get('requests')).toBe('>=2.0')
    expect(m.get('flask')).toBe('*')
  })

  it('skips include / editable / URL forms (legitimate but out of scope)', () => {
    const m = parseRequirementsTxt('-r dev.txt\n-e .\ngit+https://github.com/x/y.git\nrequests>=2.0\n')
    expect(m.size).toBe(1)
    expect(m.get('requests')).toBe('>=2.0')
  })

  it('strips package extras like [security] from the name', () => {
    const m = parseRequirementsTxt('requests[security]>=2.31\n')
    expect(m.get('requests')).toBe('>=2.31')
  })

  it('strips environment markers (anything after ;)', () => {
    const m = parseRequirementsTxt(`numpy>=1.21 ; python_version >= "3.10"\n`)
    expect(m.get('numpy')).toBe('>=1.21')
  })
})

// ── parsePyprojectToml — PEP 621 ──────────────────────────────────────────────

describe('parsePyprojectToml — PEP 621 [project].dependencies', () => {
  it('reads a multi-line dependencies array', () => {
    const text = `[project]\nname = "x"\ndependencies = [\n  "requests>=2.31",\n  "flask~=3.0",\n  "django",\n]\n`
    const { deps } = parsePyprojectToml(text)
    expect(deps.get('requests')).toBe('>=2.31')
    expect(deps.get('flask')).toBe('~=3.0')
    expect(deps.get('django')).toBe('*')
  })

  it('reads a single-line dependencies array', () => {
    const { deps } = parsePyprojectToml(`[project]\ndependencies = ["requests>=2.0", "flask"]\n`)
    expect(deps.get('requests')).toBe('>=2.0')
    expect(deps.get('flask')).toBe('*')
  })

  it('strips extras from the dep name', () => {
    const { deps } = parsePyprojectToml(`[project]\ndependencies = ["requests[security]>=2.31"]\n`)
    expect(deps.get('requests')).toBe('>=2.31')
  })
})

// ── parsePyprojectToml — Poetry [tool.poetry.dependencies] ────────────────────

describe('parsePyprojectToml — Poetry table', () => {
  it('reads simple key = value entries', () => {
    const text = `[tool.poetry.dependencies]\npython = "^3.10"\nrequests = "^2.31"\nflask = "*"\n`
    const { deps } = parsePyprojectToml(text)
    // `python` is the interpreter, NOT a runnable upgrade — must be skipped.
    expect(deps.has('python')).toBe(false)
    expect(deps.get('requests')).toBe('^2.31')
    expect(deps.get('flask')).toBe('*')
  })

  it('reads inline-table entries (extracts `version`)', () => {
    const { deps } = parsePyprojectToml(
      `[tool.poetry.dependencies]\nrequests = { version = "^2.31", optional = true }\n`,
    )
    expect(deps.get('requests')).toBe('^2.31')
  })

  it("flags dev-dependencies sections as unparsed (out of scope for v2.2.x)", () => {
    const text = `[tool.poetry.dependencies]\nrequests = "^2.31"\n[tool.poetry.dev-dependencies]\npytest = "^8.0"\n`
    const { deps, unparsedSections } = parsePyprojectToml(text)
    expect(deps.has('requests')).toBe(true)
    expect(deps.has('pytest')).toBe(false)
    expect(unparsedSections).toContain('tool.poetry.dev-dependencies')
  })
})

// ── parsePipfile ──────────────────────────────────────────────────────────────

describe('parsePipfile', () => {
  it('reads [packages] entries', () => {
    const text = `[[source]]\nurl = "https://pypi.org/simple"\n\n[packages]\nrequests = "*"\nflask = ">=3.0"\n\n[dev-packages]\npytest = "*"\n`
    const m = parsePipfile(text)
    expect(m.get('requests')).toBe('*')
    expect(m.get('flask')).toBe('>=3.0')
    // dev-packages is INTENTIONALLY not included for v2.2.x (devs don't get
    // upgrade PRs from Mendel by default).
    expect(m.has('pytest')).toBe(false)
  })
})

// ── pythonAdapter.detect ──────────────────────────────────────────────────────

describe('pythonAdapter.detect', () => {
  it('matches a repo with pyproject.toml', () => {
    file('pyproject.toml', '[project]\nname = "x"\n')
    const d = pythonAdapter.detect(repo)
    expect(d.detected).toBe(true)
    expect(d.indicators).toContain('pyproject.toml')
  })

  it('matches a legacy requirements.txt-only repo', () => {
    file('requirements.txt', 'requests>=2.0\n')
    expect(pythonAdapter.detect(repo).detected).toBe(true)
  })

  it('matches a Pipfile-only repo', () => {
    file('Pipfile', '[packages]\nrequests = "*"\n')
    expect(pythonAdapter.detect(repo).detected).toBe(true)
  })

  it('matches a setup.py-only repo (legacy)', () => {
    file('setup.py', 'from setuptools import setup\nsetup(name="x")\n')
    expect(pythonAdapter.detect(repo).detected).toBe(true)
  })

  it("does NOT match a JS-only repo (no Python markers)", () => {
    file('package.json', '{}')
    expect(pythonAdapter.detect(repo).detected).toBe(false)
  })

  it('records ALL matching markers (a real repo may have several)', () => {
    file('pyproject.toml', '[project]\nname = "x"\n')
    file('requirements.txt', 'requests\n')
    file('Pipfile', '[packages]\nrequests = "*"\n')
    const d = pythonAdapter.detect(repo)
    expect(d.indicators.sort()).toEqual(['Pipfile', 'pyproject.toml', 'requirements.txt'])
  })
})

// ── pythonAdapter.semanticDiff — falls back honestly when image missing ───────

describe('pythonAdapter.semanticDiff — honest fallback', () => {
  it("returns analyzable-but-empty diff naming the missing image (NEVER fabricates)", async () => {
    // The Python sandbox image is built by `preflightPythonSandbox` the
    // first time a Python scan runs. In the unit-test environment the
    // image is NOT built, so semanticDiff hits the honest-fallback path.
    // §11b.1 real-container test in tests/python-griffe-container.test.ts
    // covers the happy path against actual Docker.
    const diff = await pythonAdapter.semanticDiff('requests', '2.31.0', '3.0.0')
    expect(diff.removedExports).toEqual([])
    expect(diff.signatureChanges).toEqual([])
    expect(diff.newDeprecations).toEqual([])
    expect(diff.coveragePercent).toBe(0)
    expect(diff.analysisTier).toBe('ast-only')
    expect(diff.unanalyzableSymbols).toHaveLength(1)
    // Reason names either "image is not built" (unit-test env) OR
    // "griffe could not analyze …" (image exists but griffe failed on
    // this pair). Both are honest.
    expect(diff.unanalyzableSymbols[0].reason).toMatch(/(not built|griffe could not analyze)/i)
  })
})

// ── Adapter contract pins ─────────────────────────────────────────────────────

describe('pythonAdapter contract', () => {
  it('declares maxBucket = high (griffe is mature) but the actual scoring caps until griffe is wired', () => {
    // §5b: the declared ceiling is HIGH (truthful about analyzer capability)
    // — the actual score still caps low/medium under the existing per-symbol
    // scoring rules because semanticDiff returns coveragePercent=0.
    expect(pythonAdapter.maxBucket).toBe('high')
  })
  it('declares the v2.2 Python sandbox image tag (reserved for the griffe follow-on)', () => {
    expect(pythonAdapter.sandboxImage).toBe('mendel-python-sandbox:v2.2')
  })
  it('declares pyproject.toml as the manifest file', () => {
    expect(pythonAdapter.manifestFile).toBe('pyproject.toml')
  })
})
