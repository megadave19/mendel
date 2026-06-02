/**
 * v2.3 / F25 — monitor scheduler (pure policy).
 *
 * Decisions about WHEN a scheduled scan may fire live here, as pure
 * functions. The worker (worker/monitor.ts) owns IO + node-cron
 * registration; this module owns the rules.
 *
 * Pure separation buys us:
 *   1. Exhaustive boundary tests (no real clock, no real DB)
 *   2. The worker can't accidentally bypass a rule by re-implementing
 *      the decision somewhere local
 *   3. A v3 (cloud) cron service reuses this layer unchanged
 *
 * **§5b honesty knobs:**
 *   - `MIN_GAP_SECONDS` enforces a floor between fires of the same
 *     schedule even when its cron expression would otherwise trigger
 *     more often. A user typo of `* * * * *` (every minute) gets
 *     clamped to once per 5 minutes; the skipped fire is logged so
 *     the user can see why a too-frequent cron isn't running.
 *   - `validateCronExpression` is conservative: a 5-field expression
 *     made of digits, `*`, `/`, `,`, `-`. Anything else is REFUSED
 *     rather than fed to node-cron blindly. CLAUDE.md §5 r4 + r9.
 *   - `decideFire` returns `{shouldFire, reason}` — the reason lands
 *     in AgentLog so a skipped fire is never silent.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Minimum gap between successive fires of the same schedule. Defensive
 * floor: even a `* * * * *` cron is clamped to one fire per 5 minutes.
 * GitHub's authenticated rate limit is 5000/h; a 5-min floor keeps a
 * misconfigured cron from eating the whole budget on a single repo.
 */
export const MIN_GAP_SECONDS = 5 * 60

/**
 * Maximum number of concurrent in-flight scans the worker is allowed to
 * launch. Each scan spawns a Docker container + clones a repo; running
 * many in parallel can saturate the host. Defensive default = 2.
 */
export const MAX_CONCURRENT_SCANS = 2

// ── Cron expression validation ───────────────────────────────────────────────

// A 5-field cron expression: minute hour day-of-month month day-of-week.
// Each field is one of:
//   - `*`
//   - a number
//   - asterisk-slash-N (step)
//   - `A-B` (range)
//   - `A,B,C` (list)
//   - combinations like `0,30` or `1-5/2`
//
// Anything else is refused. We DON'T allow @daily, @hourly, etc — they
// vary by cron implementation, and node-cron 4.x is strict.
//
// (Block-form JSDoc deliberately avoided here — embedding the literal
// step-syntax `*/N` inside `/** … */` closes the JSDoc early; same
// gotcha that bit the Prisma docstring with the cron default value.)
const CRON_FIELD = /^(\*|\d+|\d+-\d+|\*\/\d+|\d+(?:,\d+)+|\d+-\d+\/\d+)$/

export function validateCronExpression(raw: string): { ok: true } | { ok: false; reason: string } {
  if (typeof raw !== 'string') return { ok: false, reason: 'cron expression must be a string' }
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'cron expression is empty' }
  if (trimmed.length > 100) return { ok: false, reason: 'cron expression exceeds 100 chars' }
  const fields = trimmed.split(/\s+/)
  if (fields.length !== 5) {
    return { ok: false, reason: `cron expression needs 5 space-separated fields, got ${fields.length}` }
  }
  for (let i = 0; i < fields.length; i++) {
    if (!CRON_FIELD.test(fields[i])) {
      return { ok: false, reason: `cron field ${i + 1} ("${fields[i]}") not a recognized shape` }
    }
  }
  return { ok: true }
}

// ── Decide whether to fire ──────────────────────────────────────────────────

export interface DecideFireInput {
  /** Has this schedule been enabled by the user? */
  enabled: boolean
  /** ISO timestamp of the last successful fire (null on first run). */
  lastFiredAt: Date | null
  /** Current concurrent in-flight scan count (worker-tracked). */
  inFlightCount: number
  /** Now — injectable so tests can use a fake clock. */
  now: Date
}

export type FireDecision =
  | { shouldFire: true }
  | { shouldFire: false; reason: string }

/**
 * The §5b-class honest gate for the monitor worker. Returns
 * `shouldFire: false` with a SPECIFIC reason whenever the schedule
 * should be skipped — never silently dropped.
 *
 * Order matters: most-specific rule first so the reason text identifies
 * the binding constraint.
 */
export function decideFire(input: DecideFireInput): FireDecision {
  if (!input.enabled) {
    return { shouldFire: false, reason: 'monitor disabled for this repo' }
  }
  if (input.inFlightCount >= MAX_CONCURRENT_SCANS) {
    return {
      shouldFire: false,
      reason: `${input.inFlightCount} scan(s) already in flight (max ${MAX_CONCURRENT_SCANS}); skipping until one finishes`,
    }
  }
  if (input.lastFiredAt) {
    const elapsedMs = input.now.getTime() - input.lastFiredAt.getTime()
    const elapsedSeconds = Math.floor(elapsedMs / 1000)
    if (elapsedSeconds < MIN_GAP_SECONDS) {
      return {
        shouldFire: false,
        reason: `last fire ${elapsedSeconds}s ago; minimum gap ${MIN_GAP_SECONDS}s — skipping to protect rate limits`,
      }
    }
  }
  return { shouldFire: true }
}
