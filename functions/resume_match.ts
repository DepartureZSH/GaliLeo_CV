import { createHash } from 'crypto'

interface ResumeProfile {
  name: string | null
  phone: string | null
  email: string | null
  address: string | null
  targetRole?: string | null
  expectedSalary?: string | null
  yearsOfExperience?: number | null
  skills: string[]
  projects: Array<Record<string, unknown> | string>
  education: Array<Record<string, unknown> | string>
}

export default async function (ctx: FunctionContext) {
  setCorsHeaders(ctx)

  const body = normalizeBody(ctx.body)
  const resumeId = String(body.resumeId || '').trim()
  const jobDescription = String(body.jobDescription || '').trim()
  const profile = getProfile(resumeId, body.profile)

  if (!resumeId || !jobDescription) {
    return jsonError(
      ctx,
      400,
      'INVALID_REQUEST',
      'resumeId and jobDescription are required',
    )
  }

  if (!process.env.DEEPSEEK_API_KEY) {
    return jsonError(
      ctx,
      501,
      'DEEPSEEK_NOT_CONFIGURED',
      'DEEPSEEK_API_KEY is not configured',
    )
  }

  const jdHash = createHash('sha256').update(jobDescription).digest('hex')
  const cacheKey = `resume:match:${resumeId}:${jdHash}`
  if (!profile) {
    return jsonError(
      ctx,
      400,
      'PROFILE_REQUIRED',
      'profile is required when Redis is not configured',
    )
  }

  let matchResult
  try {
    matchResult = await scoreMatchWithDeepSeek(profile, jobDescription, process.env)
  } catch (error) {
    console.error('DeepSeek resume matching failed', error)
    return jsonError(ctx, 502, 'DEEPSEEK_REQUEST_FAILED', 'DeepSeek resume matching failed')
  }

  return {
    ok: true,
    resumeId,
    ...matchResult,
    cache: {
      enabled: Boolean(process.env.REDIS_URL),
      key: cacheKey,
    },
  }
}

function setCorsHeaders(ctx: FunctionContext) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://departurezsh.github.io'
  const origin = String(ctx.headers?.origin || '')
  const responseOrigin = origin && origin.startsWith(allowedOrigin) ? origin : allowedOrigin

  ctx.response?.setHeader('Access-Control-Allow-Origin', responseOrigin)
  ctx.response?.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  ctx.response?.setHeader('Access-Control-Allow-Methods', 'GET,POST')
}

function normalizeBody(body: unknown) {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as Record<string, unknown>
    } catch {
      return {}
    }
  }

  return (body || {}) as Record<string, unknown>
}

function getProfile(resumeId: string, bodyProfile: unknown): ResumeProfile | null {
  if (bodyProfile && typeof bodyProfile === 'object') {
    return normalizeProfile(bodyProfile)
  }

  const globalStore = globalThis as typeof globalThis & {
    __galileoResumeStore?: Map<string, { profile: ResumeProfile; resumeText: string }>
  }

  return globalStore.__galileoResumeStore?.get(resumeId)?.profile ?? null
}

function jsonError(
  ctx: FunctionContext,
  status: number,
  code: string,
  message: string,
) {
  if (ctx.response) ctx.response.status(status)

  return {
    ok: false,
    code,
    message,
  }
}

async function scoreMatchWithDeepSeek(
  profile: ResumeProfile,
  jobDescription: string,
  env: NodeJS.ProcessEnv,
) {
  const result = await callDeepSeekJson({
    apiKey: requireEnv(env, 'DEEPSEEK_API_KEY'),
    baseUrl: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    messages: [
      {
        role: 'system',
        content:
          '你是招聘匹配评分助手。只返回合法 JSON，不要输出 Markdown。',
      },
      {
        role: 'user',
        content: [
          '请根据候选人简历结构化信息和岗位 JD 输出 JSON。',
          '字段必须包含 score(0-100), matchedKeywords, missingKeywords, summary。',
          'summary 用中文说明匹配原因，控制在 80 字以内。',
          '',
          `简历 JSON：${JSON.stringify(profile)}`,
          '',
          `岗位 JD：${jobDescription.slice(0, 8000)}`,
        ].join('\n'),
      },
    ],
  })

  return normalizeMatchResult(result)
}

async function callDeepSeekJson(options: {
  apiKey: string
  baseUrl: string
  model: string
  messages: Array<{ role: 'system' | 'user'; content: string }>
}) {
  const response = await fetch(`${options.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  })

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>
  }

  if (!response.ok) {
    throw new Error(
      `DeepSeek API error: ${response.status} ${JSON.stringify(payload).slice(0, 300)}`,
    )
  }

  const content = payload?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('DeepSeek API returned empty content')
  }

  try {
    return JSON.parse(content)
  } catch {
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('DeepSeek API did not return JSON')
    return JSON.parse(match[0])
  }
}

function normalizeProfile(input: unknown): ResumeProfile {
  const value = asRecord(input)

  return {
    name: nullableString(value.name),
    phone: nullableString(value.phone),
    email: nullableString(value.email),
    address: nullableString(value.address),
    targetRole: nullableString(value.targetRole),
    expectedSalary: nullableString(value.expectedSalary),
    yearsOfExperience: nullableNumber(value.yearsOfExperience),
    skills: stringArray(value.skills),
    projects: objectOrStringArray(value.projects),
    education: objectOrStringArray(value.education),
  }
}

function normalizeMatchResult(input: unknown) {
  const value = asRecord(input)

  return {
    score: clampScore(value.score),
    matchedKeywords: stringArray(value.matchedKeywords),
    missingKeywords: stringArray(value.missingKeywords),
    summary: nullableString(value.summary) || '',
  }
}

function requireEnv(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key]
  if (!value) throw new Error(`${key} is not configured`)
  return value
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function nullableString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function nullableNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return null
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
    : []
}

function objectOrStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item) =>
          typeof item === 'string' || (item && typeof item === 'object'),
      )
    : []
}

function clampScore(value: unknown) {
  const score = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(score)) return 0
  return Math.max(0, Math.min(100, Math.round(score)))
}
