import { SettingsRepository } from '../../database/repositories/settings-repository'
import { decryptJsonFields } from '../../utils/encryption'

interface StepEvent {
  type: 'step'
  id:   'config' | 'api' | 'chat'
  status: 'running' | 'success' | 'error'
  msg:  string
}

interface DoneEvent {
  type:    'done'
  overall: 'success' | 'error'
}

export default defineEventHandler(async (event) => {
  const res = event.node.res
  const req = event.node.req

  res.writeHead(200, {
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache, no-transform',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  let closed = false
  req.on('close', () => { closed = true })

  const send = (data: StepEvent | DoneEvent) => {
    if (closed) return
    try { res.write(`data: ${JSON.stringify(data)}\n\n`) } catch { closed = true }
  }

  // ── Step 0: load + decrypt settings ───────────────────────────────────────
  let apiKey = '', model = '', apiUrl = ''
  try {
    const repo = new SettingsRepository()
    const raw  = repo.getValue('llm-details')
    if (!raw) throw new Error('LLM not configured — save your settings first')
    const details   = JSON.parse(raw) as Record<string, unknown>
    const decrypted = decryptJsonFields('llm-details', details)
    apiKey = (decrypted.apiKey as string) ?? ''
    model  = (decrypted.model  as string) || 'gpt-4o'
    apiUrl = (decrypted.apiUrl as string) || 'https://models.inference.ai.azure.com'
    if (!apiKey) throw new Error('Personal Access Token is empty — enter your GitHub PAT first')
    send({ type: 'step', id: 'config', status: 'success',
      msg: `Settings loaded — Model: ${model}  URL: ${apiUrl}` })
  } catch (err) {
    send({ type: 'step', id: 'config', status: 'error', msg: String(err) })
    send({ type: 'done', overall: 'error' })
    res.end()
    return
  }

  // ── Step 1: validate PAT format ───────────────────────────────────────────
  send({ type: 'step', id: 'api', status: 'running', msg: `Connecting to ${apiUrl}…` })
  let apiOk = false
  let chatOk = false
  let latencyMs = 0
  try {
    const t0  = Date.now()
    const url = `${apiUrl.replace(/\/$/, '')}/chat/completions`
    const body = {
      model,
      messages: [
        { role: 'system',  content: 'Respond in exactly one short sentence.' },
        { role: 'user',    content: 'Say "Connection successful" and name the model you are using.' },
      ],
      temperature: 0,
      max_tokens: 80,
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(body),
    })

    latencyMs = Date.now() - t0

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      let hint = ''
      if (resp.status === 401) hint = ' — check your PAT and ensure it has the copilot scope'
      if (resp.status === 403) hint = ' — PAT lacks access to GitHub Models (copilot scope required)'
      if (resp.status === 404) hint = ' — endpoint not found, check API Base URL'
      if (resp.status === 429) hint = ' — rate limit hit, try again in a moment'
      send({ type: 'step', id: 'api', status: 'error',
        msg: `HTTP ${resp.status} ${resp.statusText}${hint}${text ? ': ' + text.slice(0, 120) : ''}` })
    } else {
      apiOk = true
      send({ type: 'step', id: 'api', status: 'success',
        msg: `HTTP 200 OK — ${latencyMs}ms — parsing response…` })

      // ── Step 2: parse chat response ──────────────────────────────────────
      send({ type: 'step', id: 'chat', status: 'running', msg: 'Parsing chat completion response…' })
      try {
        const data = await resp.json() as {
          choices?: Array<{ message?: { content?: string } }>
          model?: string
          usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
        }
        const content = data.choices?.[0]?.message?.content?.trim() ?? ''
        const usedModel = data.model ?? model
        const usage = data.usage
        const parts: string[] = [`Model: ${usedModel}`, `Latency: ${latencyMs}ms`]
        if (usage) parts.push(`Tokens: ${usage.prompt_tokens}p + ${usage.completion_tokens}c = ${usage.total_tokens}`)
        send({ type: 'step', id: 'chat', status: 'success',
          msg: `${parts.join('  ·  ')}` })
        if (content) {
          send({ type: 'step', id: 'chat', status: 'success',
            msg: `Response: "${content}"` })
        }
        chatOk = true
      } catch (err) {
        send({ type: 'step', id: 'chat', status: 'error', msg: `Failed to parse response: ${String(err)}` })
      }
    }
  } catch (err) {
    send({ type: 'step', id: 'api', status: 'error',
      msg: `Request failed: ${String(err).slice(0, 200)}` })
  }

  send({ type: 'done', overall: (apiOk && chatOk) ? 'success' : 'error' })
  res.end()
})
