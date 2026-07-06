import { useEffect, useState } from 'react'
import {
  ApiError,
  type AnalyzeResponse,
  type MatchResponse,
  checkHealth,
  getApiBaseUrl,
  matchResume,
  uploadResume,
} from './api'
import './App.css'

type Status = 'idle' | 'checking' | 'online' | 'offline'

function App() {
  const [apiStatus, setApiStatus] = useState<Status>('checking')
  const [file, setFile] = useState<File | null>(null)
  const [jobDescription, setJobDescription] = useState('')
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null)
  const [match, setMatch] = useState<MatchResponse | null>(null)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    let isMounted = true

    checkHealth()
      .then(() => {
        if (isMounted) setApiStatus('online')
      })
      .catch(() => {
        if (isMounted) setApiStatus('offline')
      })

    return () => {
      isMounted = false
    }
  }, [])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setAnalysis(null)
    setMatch(null)

    if (!file) {
      setError('请上传 PDF 格式的简历文件。')
      return
    }

    if (!isPdfFile(file)) {
      setError('请上传 PDF 格式的简历文件。')
      return
    }

    if (!jobDescription.trim()) {
      setError('请输入岗位需求描述。')
      return
    }

    setIsSubmitting(true)

    try {
      const analyzeResult = await uploadResume(file)
      setAnalysis(analyzeResult)
      const matchResult = await matchResume(
        analyzeResult.resumeId,
        jobDescription.trim(),
        analyzeResult.profile,
      )
      setMatch(matchResult)
    } catch (requestError) {
      setError(getUserFacingError(requestError))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="app-subtitle">AI 赋能的智能简历分析系统</p>
          <h1>GaliLeo CV</h1>
        </div>
        <div className={`status-pill status-pill--${apiStatus}`}>
          <span aria-hidden="true" />
          {getStatusLabel(apiStatus)}
        </div>
      </header>

      <section className="workspace" aria-label="简历分析工作台">
        <form className="input-panel" onSubmit={handleSubmit}>
          <div className="panel-heading">
            <h2>输入材料</h2>
            <p>上传一份 PDF 简历，并粘贴岗位需求描述。</p>
          </div>

          <label className="field">
            <span>上传 PDF 简历</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null)
                setError('')
              }}
            />
          </label>

          <label className="field">
            <span>岗位需求描述</span>
            <textarea
              value={jobDescription}
              onChange={(event) => setJobDescription(event.target.value)}
              rows={9}
              placeholder="例如：招聘 Python 后端开发，熟悉 Serverless、Redis、RESTful API 和 AI 模型调用..."
            />
          </label>

          {error ? <div className="alert">{error}</div> : null}

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? '分析中...' : '开始分析'}
          </button>
        </form>

        <section className="result-panel" aria-label="分析结果">
          <div className="panel-heading">
            <h2>分析结果</h2>
            <p>接口地址：{getApiBaseUrl()}</p>
          </div>

          <div className="score-card">
            <span>匹配度</span>
            <strong>{match ? match.score : '--'}</strong>
          </div>

          <div className="result-grid">
            <ResultRow label="姓名" value={analysis?.profile.name} />
            <ResultRow label="电话" value={analysis?.profile.phone} />
            <ResultRow label="邮箱" value={analysis?.profile.email} />
            <ResultRow label="地址" value={analysis?.profile.address} />
          </div>

          <TagGroup title="技能标签" items={analysis?.profile.skills ?? []} />
          <TagGroup title="命中关键词" items={match?.matchedKeywords ?? []} />
          <TagGroup title="缺失关键词" items={match?.missingKeywords ?? []} />

          <div className="summary-box">
            <h3>AI 评语</h3>
            <p>{match?.summary || '完成上传和岗位匹配后，这里会展示后端返回的评分摘要。'}</p>
          </div>
        </section>
      </section>
    </main>
  )
}

function ResultRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="result-row">
      <span>{label}</span>
      <strong>{value || '待解析'}</strong>
    </div>
  )
}

function TagGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="tag-group">
      <h3>{title}</h3>
      <div>
        {items.length > 0 ? (
          items.map((item) => <span key={item}>{item}</span>)
        ) : (
          <em>暂无数据</em>
        )}
      </div>
    </div>
  )
}

function isPdfFile(file: File) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

function getUserFacingError(error: unknown) {
  if (error instanceof ApiError && error.code === 'DEEPSEEK_NOT_CONFIGURED') {
    return '后端未配置 DeepSeek API Key。'
  }

  if (error instanceof ApiError) {
    return error.message
  }

  return '分析失败，请稍后重试。'
}

function getStatusLabel(status: Status) {
  if (status === 'online') return 'API 在线'
  if (status === 'offline') return 'API 离线'
  if (status === 'checking') return '检查中'
  return '待检测'
}

export default App
