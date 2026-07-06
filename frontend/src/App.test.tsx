import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
})

describe('App', () => {
  it('rejects non-PDF uploads before calling the API', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<App />)

    await user.upload(
      screen.getByLabelText('上传 PDF 简历'),
      new File(['hello'], 'resume.txt', { type: 'text/plain' }),
    )
    await user.type(screen.getByLabelText('岗位需求描述'), 'Python 后端开发')
    await user.click(screen.getByRole('button', { name: '开始分析' }))

    expect(fetchMock).not.toHaveBeenCalledWith(
      'https://w8m6b6odq5.sealosbja.site/resume_analyze',
      expect.anything(),
    )
    expect(screen.getByText('请上传 PDF 格式的简历文件。')).toBeInTheDocument()
  })

  it('shows the DeepSeek configuration error from the real backend contract', async () => {
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
    const user = userEvent.setup()
    render(<App />)

    await user.upload(
      screen.getByLabelText('上传 PDF 简历'),
      new File(['%PDF'], 'resume.pdf', { type: 'application/pdf' }),
    )
    await user.type(screen.getByLabelText('岗位需求描述'), 'Python 后端开发')
    await user.click(screen.getByRole('button', { name: '开始分析' }))

    expect(
      await screen.findByText('后端未配置 DeepSeek API Key。'),
    ).toBeInTheDocument()
  })
})
