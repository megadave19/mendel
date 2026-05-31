/**
 * Pref hydration — runs BEFORE React mounts so reduce-motion / hide-mascot
 * apply on first paint with no flash. Referenced from app/layout.tsx via
 * <script src="/prefs-init.js">. Static asset, no inline content — keeps
 * the codebase aligned with CLAUDE.md §5 rule 9 (no inline-html injection).
 *
 * Pref keys must match hooks/use-user-prefs.ts PREF_KEY. If you edit one,
 * grep both.
 */
(function () {
  try {
    var ls = window.localStorage;
    var rm = ls.getItem('mendel:pref:reduceMotion');
    var ms = ls.getItem('mendel:pref:mascot');
    var h = document.documentElement;
    h.dataset.reduceMotion = rm === '1' ? '1' : '0';
    // mascot defaults to ON; only an explicit '0' hides it.
    h.dataset.mascot = ms === '0' ? '0' : '1';
  } catch (e) {
    /* localStorage access denied (private mode, SSR) — leave defaults. */
  }
})();
