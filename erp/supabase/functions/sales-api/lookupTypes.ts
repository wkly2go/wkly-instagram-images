export interface SalesLookupRow {
  title: string
  facts: { label: string; value: string }[]
  url?: string
  id?: string
}

export interface SalesLookupResult {
  rows: SalesLookupRow[]
  total?: number
  note?: string
}

export interface SalesLookupPlan {
  url: URL
  headers?: Record<string, string>
  parse: (value: unknown) => SalesLookupResult
}

export class LookupError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}
