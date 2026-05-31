# Mendel Calibration Report — `v2.0-with-F20`

Generated: 2026-05-31T14:10:34.014Z · commit `2ab45de5b029`

## Headline

- **Fixtures:** 7
- **Passed:** 7 / 7 (100%)
- **Bucket accuracy:** 100%
- **Overall-in-range:** 100%

## Bucket confusion

| expected ↓ / observed → | high | medium | low |
| --- | --- | --- | --- |
| **high** | 2 | 0 | 0 |
| **medium** | 0 | 2 | 0 |
| **low** | 0 | 0 | 3 |

## Per-fixture

| status | id | package | bucket | overall | duration |
| --- | --- | --- | --- | --- | --- |
| ✓ | `axios-0.24-to-0.27` | axios 0.24.0→0.27.2 | high | 90 | 8ms |
| ✓ | `changelog-only-high-coverage` | synthetic-changelog-only 5.0.0→6.0.0 | low | 48 | 0ms |
| ✓ | `semantic-only-undocumented` | synthetic-semantic-only 3.0.0→4.0.0 | medium | 70 | 0ms |
| ✓ | `smoke-failed-cap` | synthetic-smoke-cap 9.0.0→10.0.0 | low | 50 | 0ms |
| ✓ | `synthetic-self-test` | synthetic 1.0.0→2.0.0 | high | 90 | 0ms |
| ✓ | `verification-failed-cap` | synthetic-verify-cap 7.0.0→8.0.0 | low | 50 | 0ms |
| ✓ | `version-bump-only` | synthetic-bump-only 1.2.3→1.2.4 | medium | 75 | 0ms |

