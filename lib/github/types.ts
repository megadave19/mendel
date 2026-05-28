export interface GitHubUser {
  login: string
  name: string | null
  email: string | null
}

export interface PatValidationResult {
  valid: boolean
  user: GitHubUser | null
  scopes: string[]
  missingScopes: string[]
  error?: string
}

export interface RepoMeta {
  owner: string
  repo: string
  defaultBranch: string
  size: number
  private: boolean
  fork: boolean
}

export interface MonorepoDetectionResult {
  isMonorepo: boolean
  indicators: string[]
}

export interface OpenPR {
  number: number
  title: string
  url: string
  headRef: string
  draft: boolean
}

/**
 * v1.5 W#10 Push 2 — current GitHub state of a Mendel-opened PR, used by the
 * PR-state poller to detect merge/close transitions automatically.
 */
export interface PullRequestState {
  state: 'open' | 'closed'
  merged: boolean
  mergedAt: string | null
  closedAt: string | null
}

export type GitHubErrorKind =
  | 'auth'
  | 'rate-limit'
  | 'not-found'
  | 'network'
  | 'validation'
  | 'unknown'

export class GitHubError extends Error {
  constructor(
    public kind: GitHubErrorKind,
    message: string,
    public retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'GitHubError'
  }
}
