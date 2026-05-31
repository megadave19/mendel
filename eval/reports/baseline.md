# Mendel Calibration Report — `v2.0-baseline`

Generated: 2026-05-31T13:46:33.666Z · commit `80fbc7a5f3dc`

## Headline

- **Fixtures:** 6
- **Passed:** 6 / 6 (100%)
- **Bucket accuracy:** 100%
- **Overall-in-range:** 100%

## Bucket confusion

| expected ↓ / observed → | high | medium | low |
| --- | --- | --- | --- |
| **high** | 2 | 0 | 0 |
| **medium** | 0 | 2 | 0 |
| **low** | 0 | 0 | 2 |

## Per-fixture

| status | id | package | bucket | overall | duration |
| --- | --- | --- | --- | --- | --- |
| ✓ | `axios-0.24-to-0.27` | axios 0.24.0→0.27.2 | high | 90 | 10ms |
| ✓ | `changelog-only-high-coverage` | synthetic-changelog-only 5.0.0→6.0.0 | low | 48 | 0ms |
| ✓ | `semantic-only-undocumented` | synthetic-semantic-only 3.0.0→4.0.0 | medium | 70 | 0ms |
| ✓ | `synthetic-self-test` | synthetic 1.0.0→2.0.0 | high | 90 | 0ms |
| ✓ | `verification-failed-cap` | synthetic-verify-cap 7.0.0→8.0.0 | low | 50 | 0ms |
| ✓ | `version-bump-only` | synthetic-bump-only 1.2.3→1.2.4 | medium | 75 | 0ms |

