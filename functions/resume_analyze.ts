import { createHash } from 'crypto'
import { connect } from 'net'

interface UploadedFile {
  buffer?: Buffer
  data?: Buffer
  content?: Buffer
  originalname?: string
  filename?: string
  name?: string
  mimetype?: string
  type?: string
  contentBase64?: string
  size?: number
}

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

interface ParsedResumeCache {
  profile: ResumeProfile
  resumeText: string
}

interface CacheMetadata {
  enabled: boolean
  key: string
  hit?: boolean
}

export default async function (ctx: FunctionContext) {
  setCorsHeaders(ctx)

  const body = normalizeBody(ctx.body)
  const file = getUploadedFile(ctx, body)
  if (!file) {
    return jsonError(ctx, 400, 'INVALID_FILE', 'PDF resume file is required')
  }

  const fileName = file.originalname || file.filename || file.name || ''
  const mimeType = file.mimetype || file.type || ''

  if (!isPdf(fileName, mimeType)) {
    return jsonError(ctx, 400, 'INVALID_FILE', 'Only PDF files are supported')
  }

  if (!process.env.DEEPSEEK_API_KEY) {
    return jsonError(
      ctx,
      501,
      'DEEPSEEK_NOT_CONFIGURED',
      'DEEPSEEK_API_KEY is not configured',
    )
  }

  const buffer = getFileBuffer(file)
  if (!buffer) {
    return jsonError(ctx, 400, 'INVALID_FILE', 'Uploaded PDF content is empty')
  }

  const resumeId = createHash('sha256')
    .update(buffer)
    .digest('hex')

  const cacheKey = `resume:parse:${resumeId}`
  const cachedResume = await getCacheJson<ParsedResumeCache>(cacheKey)
  if (cachedResume) {
    setStoredResume(resumeId, cachedResume.profile, cachedResume.resumeText)

    return {
      ok: true,
      resumeId,
      cache: getCacheMetadata(cacheKey, true),
      profile: cachedResume.profile,
    }
  }

  const resumeText = await extractPdfText(buffer)
  if (!resumeText) {
    return jsonError(ctx, 422, 'PDF_PARSE_FAILED', 'Could not extract text from PDF')
  }

  let profile: ResumeProfile
  try {
    profile = await extractProfileWithDeepSeek(resumeText, process.env)
  } catch (error) {
    console.error('DeepSeek resume extraction failed', error)
    return jsonError(ctx, 502, 'DEEPSEEK_REQUEST_FAILED', 'DeepSeek resume extraction failed')
  }

  setStoredResume(resumeId, profile, resumeText)
  await setCacheJson(cacheKey, { profile, resumeText })

  return {
    ok: true,
    resumeId,
    cache: getCacheMetadata(cacheKey, false),
    profile,
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

function getUploadedFile(
  ctx: FunctionContext,
  body: Record<string, unknown>,
): UploadedFile | null {
  const bodyFile = getBodyFile(body)
  if (bodyFile) return bodyFile

  const files = ctx.files
  if (!files) return null
  if (Array.isArray(files)) return (files[0] as UploadedFile | undefined) ?? null

  const keyedFiles = files as Record<string, UploadedFile | UploadedFile[]>
  const file = keyedFiles.file
  return Array.isArray(file) ? file[0] ?? null : file ?? null
}

function getFileBuffer(file: UploadedFile) {
  if (typeof file.contentBase64 === 'string' && file.contentBase64.trim()) {
    return Buffer.from(file.contentBase64, 'base64')
  }

  return file.buffer || file.data || file.content || null
}

function getBodyFile(body: Record<string, unknown>): UploadedFile | null {
  const contentBase64 = body.contentBase64
  if (typeof contentBase64 !== 'string') return null

  return {
    contentBase64,
    name: typeof body.fileName === 'string' ? body.fileName : undefined,
    mimetype: typeof body.mimeType === 'string' ? body.mimeType : undefined,
    size: typeof body.size === 'number' ? body.size : undefined,
  }
}

async function extractPdfText(buffer: Buffer) {
  const parsedText = await extractWithPdfParse(buffer)
  if (parsedText) return cleanExtractedText(parsedText)

  const fallbackText = extractReadablePdfText(buffer)
  if (fallbackText) return cleanExtractedText(fallbackText)

  return ''
}

async function extractWithPdfParse(buffer: Buffer) {
  try {
    const pdfParse = require('pdf-parse') as (
      buffer: Buffer,
    ) => Promise<{ text?: string }>
    const parsed = await pdfParse(buffer)
    return String(parsed.text || '')
  } catch (error) {
    console.warn('pdf-parse unavailable or failed, using fallback extractor', error)
    return ''
  }
}

function extractReadablePdfText(buffer: Buffer) {
  const source = buffer.toString('latin1')
  const parts: string[] = []

  for (const match of source.matchAll(/\[((?:\s*(?:\((?:\\.|[^\\)])*\)|<[\da-fA-F\s]+>)[^\]]*)+)\]\s*TJ/g)) {
    parts.push(decodePdfTextGroup(match[1]))
  }

  for (const match of source.matchAll(/\((?:\\.|[^\\)])*\)\s*Tj/g)) {
    parts.push(decodePdfLiteral(match[0].replace(/\)\s*Tj$/, '').slice(1)))
  }

  if (parts.length === 0) {
    for (const match of source.matchAll(/\((?:\\.|[^\\)]){3,}\)/g)) {
      parts.push(decodePdfLiteral(match[0].slice(1, -1)))
    }
  }

  return parts.join('\n')
}

function decodePdfTextGroup(value: string) {
  const parts: string[] = []

  for (const match of value.matchAll(/\((?:\\.|[^\\)])*\)|<[\da-fA-F\s]+>/g)) {
    const token = match[0]
    parts.push(token.startsWith('(')
      ? decodePdfLiteral(token.slice(1, -1))
      : decodePdfHex(token.slice(1, -1)))
  }

  return parts.join('')
}

function decodePdfLiteral(value: string) {
  return value
    .replace(/\\([0-7]{1,3})/g, (_, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\b/g, '\b')
    .replace(/\\f/g, '\f')
    .replace(/\\([\\()])/g, '$1')
}

function decodePdfHex(value: string) {
  const hex = value.replace(/\s+/g, '')
  if (!hex) return ''

  const normalized = hex.length % 2 === 0 ? hex : `${hex}0`
  const bytes = Buffer.from(normalized, 'hex')
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const chars: string[] = []
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      chars.push(String.fromCharCode(bytes.readUInt16BE(index)))
    }
    return chars.join('')
  }

  return bytes.toString('utf8')
}

function cleanExtractedText(text: string) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter((line) => line && !isPageNoise(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isPageNoise(line: string) {
  return /^第\s*\d+\s*页\s*\/\s*共\s*\d+\s*页$/i.test(line)
    || /^page\s*\d+\s*of\s*\d+$/i.test(line)
    || /^[-_—=]{3,}$/.test(line)
}

function isPdf(fileName: string, mimeType: string) {
  return mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')
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

function setStoredResume(
  resumeId: string,
  profile: ResumeProfile,
  resumeText: string,
) {
  const globalStore = globalThis as typeof globalThis & {
    __galileoResumeStore?: Map<string, { profile: ResumeProfile; resumeText: string }>
  }

  if (!globalStore.__galileoResumeStore) {
    globalStore.__galileoResumeStore = new Map()
  }

  globalStore.__galileoResumeStore.set(resumeId, { profile, resumeText })
}

async function extractProfileWithDeepSeek(
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
          '你是招聘简历结构化解析助手。只返回合法 JSON，不要输出 Markdown；无法确认的信息返回 null 或空数组，不要编造。',
      },
      {
        role: 'user',
        content: [
          '请从以下多页简历文本中提取结构化 JSON。',
          '必须包含以下字段：',
          '1. 基本信息：name, phone, email, address。',
          '2. 求职信息：targetRole, expectedSalary。',
          '3. 背景信息：yearsOfExperience, skills, projects, education。',
          'projects 数组中尽量保留项目名称、角色、技术栈、职责、成果。',
          'education 数组中尽量保留学校、学历、专业、时间。',
          'yearsOfExperience 返回数字；不存在的信息返回 null 或空数组。',
          '',
          resumeText.slice(0, 12000),
        ].join('\n'),
      },
    ],
  })

  return normalizeProfile(result)
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
