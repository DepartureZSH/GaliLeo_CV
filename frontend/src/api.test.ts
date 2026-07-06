import { describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  getApiBaseUrl,
  matchResume,
  uploadResume,
} from './api'

describe('api client', () => {
  it('uses the configured Laf API base URL by default', () => {
    expect(getApiBaseUrl()).toBe('https://w8m6b6odq5.sealosbja.site')
  })

  it('posts PDF uploads to /resume_analyze', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          resumeId: 'abc123',
          profile: { name: '张三', skills: [] },
        }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const file = new File(['resume'], 'resume.pdf', {
      type: 'application/pdf',
    })
    const result = await uploadResume(file)

    expect(result.resumeId).toBe('abc123')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://w8m6b6odq5.sealosbja.site/resume_analyze',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData),
      }),
    )
  })

  it('throws a typed error when the backend reports missing DeepSeek config', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 501,
        json: () =>
          Promise.resolve({
            ok: false,
            code: 'DEEPSEEK_NOT_CONFIGURED',
            message: 'DEEPSEEK_API_KEY is not configured',
          }),
      }),
    )

    await expect(matchResume('abc123', 'Python 后端')).rejects.toMatchObject({
      code: 'DEEPSEEK_NOT_CONFIGURED',
      status: 501,
    } satisfies Partial<ApiError>)
  })
})

