import { describe, expect, it, vi } from 'vitest'
import {
  buildMatchCacheKey,
  buildParseCacheKey,
  callDeepSeekJson,
  getCachedJson,
  normalizeMatchResult,
  normalizeProfile,
  setCachedJson,
  cleanResumeText,
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

  it('normalizes richer extracted profile fields', () => {
    expect(
      normalizeProfile({
        name: ' 李四 ',
        phone: ' 138-0000-0000 ',
        email: 'lisi@example.com',
        address: '北京',
        targetRole: 'Python 后端工程师',
        expectedSalary: '25k-35k',
        yearsOfExperience: '5',
        skills: [' Python ', '', 'Redis'],
        projects: [
          {
            name: '智能简历系统',
            role: '后端开发',
            description: '负责 PDF 解析和 Redis 缓存',
          },
        ],
        education: [
          {
            school: '某大学',
            degree: '本科',
            major: '软件工程',
            period: '2015-2019',
          },
        ],
      }),
    ).toEqual({
      name: '李四',
      phone: '138-0000-0000',
      email: 'lisi@example.com',
      address: '北京',
      targetRole: 'Python 后端工程师',
      expectedSalary: '25k-35k',
      yearsOfExperience: 5,
      skills: ['Python', 'Redis'],
      projects: [
        {
          name: '智能简历系统',
          role: '后端开发',
          description: '负责 PDF 解析和 Redis 缓存',
        },
      ],
      education: [
        {
          school: '某大学',
          degree: '本科',
          major: '软件工程',
          period: '2015-2019',
        },
      ],
    })
  })

  it('cleans multi-page resume text and keeps useful paragraph boundaries', () => {
    expect(
      cleanResumeText(`
        \u0000 张三   |  Python 后端工程师
        电话：13800000000   邮箱：zhangsan@example.com


        第 1 页 / 共 2 页
        项目经历
        GaliLeo CV：负责 PDF 解析、DeepSeek 调用。

        Page 2 of 2
        教育经历
        某大学 计算机科学 本科
      `),
    ).toBe([
      '张三 | Python 后端工程师',
      '电话：13800000000 邮箱：zhangsan@example.com',
      '项目经历',
      'GaliLeo CV：负责 PDF 解析、DeepSeek 调用。',
      '教育经历',
      '某大学 计算机科学 本科',
    ].join('\n'))
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

  it('builds deterministic cache keys for parse and match results', () => {
    expect(buildParseCacheKey('resume-sha')).toBe('resume:parse:resume-sha')
    expect(buildMatchCacheKey('resume-sha', 'Python 后端')).toBe(
      'resume:match:resume-sha:6b7c90bfbd61038cbbdebdf9150c5fcd51a6ef9c6ca3df34135c56c6b40d5151',
    )
  })

  it('stores and reads JSON cache values through a Redis-like client', async () => {
    const store = new Map<string, string>()
    const redis = {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value)
        return 'OK'
      }),
    }

    await setCachedJson(redis, 'cache:key', { ok: true, score: 92 }, 3600)
    await expect(getCachedJson<{ score: number }>(redis, 'cache:key')).resolves.toEqual({
      ok: true,
      score: 92,
    })
    expect(redis.set).toHaveBeenCalledWith(
      'cache:key',
      '{"ok":true,"score":92}',
      'EX',
      3600,
    )
  })
})
