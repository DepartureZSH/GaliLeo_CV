import { createHash } from 'crypto'

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

  return {
    ok: true,
    resumeId,
    score: 0,
    matchedKeywords: [],
    missingKeywords: [],
    summary: '',
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

