import { createHash } from 'crypto'

export interface ResumeProfile {
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

export interface MatchResult {
  score: number
  matchedKeywords: string[]
  missingKeywords: string[]
  summary: string
}

type FetchLike = typeof fetch

interface RedisLike {
  get(key: string): Promise<string | null>
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>
}

interface DeepSeekOptions {
  apiKey: string
  baseUrl: string
  model: string
  messages: Array<{ role: 'system' | 'user'; content: string }>
  fetchImpl?: FetchLike
}

export function normalizeProfile(input: unknown): ResumeProfile {
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

export function normalizeMatchResult(input: unknown): MatchResult {
  const value = asRecord(input)

  return {
    score: clampScore(value.score),
    matchedKeywords: stringArray(value.matchedKeywords),
    missingKeywords: stringArray(value.missingKeywords),
    summary: nullableString(value.summary) || '',
  }
}

export async function extractProfileWithDeepSeek(
  resumeText: string,
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
          '你是招聘简历结构化解析助手。只返回合法 JSON，不要输出 Markdown。',
      },
      {
        role: 'user',
        content: [
          '请从以下简历文本中提取 JSON，字段为：',
          'name, phone, email, address, targetRole, expectedSalary, yearsOfExperience, skills, projects, education。',
          '不存在的信息返回 null 或空数组。',
          '',
          resumeText.slice(0, 12000),
        ].join('\n'),
      },
    ],
  })

  return normalizeProfile(result)
}

export async function scoreMatchWithDeepSeek(
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

export function cleanResumeText(text: string) {
  return text
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter((line) => line && !isPageNoise(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function buildParseCacheKey(resumeId: string) {
  return `resume:parse:${resumeId}`
}

export function buildMatchCacheKey(resumeId: string, jobDescription: string) {
  const jdHash = createHash('sha256').update(jobDescription).digest('hex')
  return `resume:match:${resumeId}:${jdHash}`
}

export async function getCachedJson<T>(redis: RedisLike, key: string) {
  const value = await redis.get(key)
  if (!value) return null
  return JSON.parse(value) as T
}

export async function setCachedJson(
  redis: RedisLike,
  key: string,
  value: unknown,
  ttlSeconds: number,
) {
  await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds)
}

export async function callDeepSeekJson(options: DeepSeekOptions) {
  const fetchImpl = options.fetchImpl || fetch
  const response = await fetchImpl(`${trimSlash(options.baseUrl)}/chat/completions`, {
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

  return parseJsonObject(content)
}

function parseJsonObject(content: string) {
  try {
    return JSON.parse(content)
  } catch {
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('DeepSeek API did not return JSON')
    return JSON.parse(match[0])
  }
}

function requireEnv(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key]
  if (!value) throw new Error(`${key} is not configured`)
  return value
}

function trimSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function isPageNoise(line: string) {
  return /^第\s*\d+\s*页\s*\/\s*共\s*\d+\s*页$/i.test(line)
    || /^page\s*\d+\s*of\s*\d+$/i.test(line)
    || /^[-_—=]{3,}$/.test(line)
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
