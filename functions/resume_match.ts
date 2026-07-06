import { createHash } from 'crypto'
import { connect } from 'net'

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

interface MatchResult {
  score: number
  matchedKeywords: string[]
  missingKeywords: string[]
  summary: string
}

interface ParsedResumeCache {
  profile: ResumeProfile
  resumeText?: string
}

interface CacheMetadata {
  enabled: boolean
  key: string
  hit?: boolean
}

export default async function (ctx: FunctionContext) {
  setCorsHeaders(ctx)

  const body = normalizeBody(ctx.body)
  const resumeId = String(body.resumeId || '').trim()
  const jobDescription = String(body.jobDescription || '').trim()

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
  const cachedMatch = await getCacheJson<MatchResult>(cacheKey)
  if (cachedMatch) {
    return {
      ok: true,
      resumeId,
      ...cachedMatch,
      cache: getCacheMetadata(cacheKey, true),
    }
  }

  const profile = await getProfile(resumeId, body.profile)
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

  await setCacheJson(cacheKey, matchResult)

  return {
    ok: true,
    resumeId,
    ...matchResult,
    cache: getCacheMetadata(cacheKey, false),
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

async function getProfile(resumeId: string, bodyProfile: unknown): Promise<ResumeProfile | null> {
  if (bodyProfile && typeof bodyProfile === 'object') {
    return normalizeProfile(bodyProfile)
  }

  const globalStore = globalThis as typeof globalThis & {
    __galileoResumeStore?: Map<string, { profile: ResumeProfile; resumeText: string }>
  }

  const memoryProfile = globalStore.__galileoResumeStore?.get(resumeId)?.profile
  if (memoryProfile) return memoryProfile

  const cachedResume = await getCacheJson<ParsedResumeCache>(`resume:parse:${resumeId}`)
  return cachedResume?.profile ? normalizeProfile(cachedResume.profile) : null
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
          '你是招聘匹配评分助手。只返回合法 JSON，不要输出 Markdown；评分必须基于证据，不要编造候选人经历。',
      },
      {
        role: 'user',
        content: [
          '请根据候选人简历结构化信息和岗位 JD 输出 JSON。',
          '字段必须包含 score(0-100), matchedKeywords, missingKeywords, summary。',
          'matchedKeywords 只列简历和岗位都明确出现或语义强相关的关键词。',
          'missingKeywords 列岗位要求但简历未体现的关键词。',
          'summary 用中文说明匹配原因，控制在 100 字以内。',
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

function getCacheMetadata(key: string, hit: boolean): CacheMetadata {
  return {
    enabled: Boolean(process.env.REDIS_URL),
    hit,
    key,
  }
}

async function getCacheJson<T>(key: string) {
  const redis = getRedisClient()
  if (!redis) return null

  try {
    const value = await redis.get(key)
    return value ? (JSON.parse(value) as T) : null
  } catch (error) {
    console.warn('Redis cache read failed', error)
    return null
  }
}

async function setCacheJson(key: string, value: unknown) {
  const redis = getRedisClient()
  if (!redis) return

  try {
    await redis.set(key, JSON.stringify(value), 'EX', getCacheTtlSeconds())
  } catch (error) {
    console.warn('Redis cache write failed', error)
  }
}

function getRedisClient() {
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) return null

  const globalStore = globalThis as typeof globalThis & {
    __galileoRedis?: {
      get(key: string): Promise<string | null>
      set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>
    }
  }

  if (!globalStore.__galileoRedis) {
    try {
      globalStore.__galileoRedis = createRedisClient(redisUrl)
    } catch (error) {
      console.warn('Redis client initialization failed', error)
      return null
    }
  }

  return globalStore.__galileoRedis
}

function getCacheTtlSeconds() {
  const ttl = Number(process.env.REDIS_TTL_SECONDS)
  return Number.isFinite(ttl) && ttl > 0 ? Math.round(ttl) : 86400
}

function createRedisClient(redisUrl: string) {
  return {
    async get(key: string) {
      const value = await runRedisCommand(redisUrl, ['GET', key])
      return typeof value === 'string' ? value : null
    },
    async set(key: string, value: string, mode: 'EX', ttlSeconds: number) {
      return runRedisCommand(redisUrl, ['SET', key, value, mode, String(ttlSeconds)])
    },
  }
}

function runRedisCommand(redisUrl: string, command: string[]) {
  return new Promise<unknown>((resolve, reject) => {
    const url = new URL(redisUrl)
    const password = decodeURIComponent(url.password)
    const username = decodeURIComponent(url.username)
    const commands = password
      ? [['AUTH', username || 'default', password], command]
      : [command]
    const expectedResponses = commands.length
    const socket = connect({
      host: url.hostname,
      port: Number(url.port || 6379),
      timeout: 2500,
    })
    let buffer = Buffer.alloc(0)
    const responses: unknown[] = []

    socket.on('connect', () => {
      socket.write(commands.map(encodeRedisCommand).join(''))
    })
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])

      try {
        while (responses.length < expectedResponses) {
          const parsed = parseRedisResponse(buffer)
          if (!parsed) return
          responses.push(parsed.value)
          buffer = buffer.subarray(parsed.offset)
        }

        socket.end()
        resolve(responses[responses.length - 1])
      } catch (error) {
        socket.destroy()
        reject(error)
      }
    })
    socket.on('timeout', () => {
      socket.destroy()
      reject(new Error('Redis command timed out'))
    })
    socket.on('error', reject)
  })
}

function encodeRedisCommand(args: string[]) {
  return `*${args.length}\r\n${args
    .map((arg) => {
      const value = Buffer.from(arg)
      return `$${value.length}\r\n${arg}\r\n`
    })
    .join('')}`
}

function parseRedisResponse(buffer: Buffer): { value: unknown; offset: number } | null {
  const type = String.fromCharCode(buffer[0])
  const lineEnd = buffer.indexOf('\r\n')
  if (lineEnd < 0) return null
  const line = buffer.subarray(1, lineEnd).toString()

  if (type === '+') return { value: line, offset: lineEnd + 2 }
  if (type === ':') return { value: Number(line), offset: lineEnd + 2 }
  if (type === '-') throw new Error(`Redis error: ${line}`)

  if (type === '$') {
    const length = Number(line)
    if (length === -1) return { value: null, offset: lineEnd + 2 }
    const start = lineEnd + 2
    const end = start + length
    if (buffer.length < end + 2) return null
    return {
      value: buffer.subarray(start, end).toString(),
      offset: end + 2,
    }
  }

  throw new Error(`Unsupported Redis response type: ${type}`)
}
