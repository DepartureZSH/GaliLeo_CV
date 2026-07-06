import { createHash } from 'crypto'

interface UploadedFile {
  buffer?: Buffer
  data?: Buffer
  content?: Buffer
  originalname?: string
  filename?: string
  name?: string
  mimetype?: string
  type?: string
  size?: number
}

export default async function (ctx: FunctionContext) {
  setCorsHeaders(ctx)

  const file = getUploadedFile(ctx)
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
  const resumeId = createHash('sha256')
    .update(buffer || fileName || String(Date.now()))
    .digest('hex')

  const cacheKey = `resume:parse:${resumeId}`

  return {
    ok: true,
    resumeId,
    cache: {
      enabled: Boolean(process.env.REDIS_URL),
      key: cacheKey,
    },
    profile: {
      name: null,
      phone: null,
      email: null,
      address: null,
      skills: [],
      projects: [],
      education: [],
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

function getUploadedFile(ctx: FunctionContext): UploadedFile | null {
  const files = ctx.files
  if (!files) return null
  if (Array.isArray(files)) return (files[0] as UploadedFile | undefined) ?? null

  const keyedFiles = files as Record<string, UploadedFile | UploadedFile[]>
  const file = keyedFiles.file
  return Array.isArray(file) ? file[0] ?? null : file ?? null
}

function getFileBuffer(file: UploadedFile) {
  return file.buffer || file.data || file.content || null
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

