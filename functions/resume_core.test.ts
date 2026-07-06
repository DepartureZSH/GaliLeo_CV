import { describe, expect, it, vi } from 'vitest'
import {
  callDeepSeekJson,
  normalizeMatchResult,
  normalizeProfile,
} from './resume_core'

describe('resume core', () => {
  it('normalizes extracted profile data from model JSON', () => {
    expect(
      normalizeProfile({
        name: '张三',
        phone: '13800000000',
        email: 'zhangsan@example.com',
        address: '上海',
        skills: ['Python', 'Redis'],
        projects: [{ name: '简历分析', description: 'AI 项目' }],
        education: [{ school: '某大学', degree: '本科', major: '计算机' }],
      }),
    ).toEqual({
      name: '张三',
      phone: '13800000000',
      email: 'zhangsan@example.com',
      address: '上海',
      targetRole: null,
      expectedSalary: null,
      yearsOfExperience: null,
      skills: ['Python', 'Redis'],
      projects: [{ name: '简历分析', description: 'AI 项目' }],
      education: [{ school: '某大学', degree: '本科', major: '计算机' }],
    })
  })

  it('normalizes match scores and keyword arrays', () => {
    expect(
      normalizeMatchResult({
        score: 86,
        matchedKeywords: ['Python', 'Redis'],
        missingKeywords: ['Kubernetes'],
        summary: '匹配度较高',
      }),
    ).toEqual({
      score: 86,
      matchedKeywords: ['Python', 'Redis'],
      missingKeywords: ['Kubernetes'],
      summary: '匹配度较高',
    })
  })

  it('calls DeepSeek chat completions and parses JSON object responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: '{"score": 77, "summary": "可进入下一轮"}',
              },
            },
          ],
        }),
    })

    const result = await callDeepSeekJson({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'Return json' }],
      fetchImpl: fetchMock,
    })

    expect(result).toEqual({ score: 77, summary: '可进入下一轮' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepseek.com/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
        }),
      }),
    )
  })
})
