export default async function (ctx: FunctionContext) {
  setCorsHeaders(ctx)

  return {
    ok: true,
    service: 'galileo-cv-api',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
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

