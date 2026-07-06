export type ApiErrorCode =
  | 'DEEPSEEK_NOT_CONFIGURED'
  | 'INVALID_FILE'
  | 'INVALID_REQUEST'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR'

export class ApiError extends Error {
  code: ApiErrorCode
  status: number

  constructor(message: string, code: ApiErrorCode, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

export interface ResumeProfile {
  name: string | null
  phone: string | null
  email: string | null
  address: string | null
  skills: string[]
  projects: Array<{ name?: string; description?: string } | string>
  education: Array<{ school?: string; degree?: string; major?: string } | string>
}

export interface AnalyzeResponse {
  ok: true
  resumeId: string
  profile: ResumeProfile
}

export interface MatchResponse {
  ok: true
  resumeId: string
  score: number
  matchedKeywords: string[]
  missingKeywords: string[]
  summary: string
}

interface ErrorResponse {
  ok: false
  code?: ApiErrorCode
  message?: string
}

const DEFAULT_API_BASE_URL = 'https://w8m6b6odq5.sealosbja.site'

export function getApiBaseUrl() {
  return (
    import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ??
    DEFAULT_API_BASE_URL
  )
}

export async function checkHealth() {
  return requestJson<{ ok: boolean; service: string; version: string }>(
    '/health',
  )
}

export async function uploadResume(file: File) {
  const formData = new FormData()
  formData.append('file', file)

  return requestJson<AnalyzeResponse>('/resume_analyze', {
    method: 'POST',
    body: formData,
  })
}

export async function matchResume(
  resumeId: string,
  jobDescription: string,
) {
  return requestJson<MatchResponse>('/resume_match', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ resumeId, jobDescription }),
  })
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response

  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, init)
  } catch {
    throw new ApiError('无法连接后端服务，请稍后重试。', 'NETWORK_ERROR')
  }

  const payload = (await readJson(response)) as T | ErrorResponse

  if (!response.ok) {
    const errorPayload = payload as ErrorResponse
    throw new ApiError(
      errorPayload.message ?? '后端接口返回异常。',
      errorPayload.code ?? 'UNKNOWN_ERROR',
      response.status,
    )
  }

  return payload as T
}

async function readJson(response: Response) {
  try {
    return await response.json()
  } catch {
    return {
      ok: false,
      code: 'UNKNOWN_ERROR',
      message: '后端返回了无法解析的数据。',
    } satisfies ErrorResponse
  }
}

