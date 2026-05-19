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
