// Runs in the page context (not the content-script isolated world)
// Captures NotebookLM batchexecute context + Studio list (gArtLc) and notifies content script.

(() => {
  if (window.__MINDDOCK_NOTEBOOKLM_NETWORK_HOOK_INSTALLED__) return
  window.__MINDDOCK_NOTEBOOKLM_NETWORK_HOOK_INSTALLED__ = true

  const MUTATION_RPC_IDS = new Set([
    'izAoDd', // add text/gdoc source
    'tGMBJ', // delete source
    'FLmJqe', // sync gdoc source
    'VUsiyb', // notebook summary (often refreshed on mutations)
    'rLM1Ne', // sources/status
    'wXbhsf' // list notebooks
  ])

  const STUDIO_RPC_ID = 'gArtLc'
  const CONTEXT_KEY = '__minddock_rpc_context'
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

  const parseNotebookIdFromSourcePath = (sourcePath) => {
    if (!sourcePath || typeof sourcePath !== 'string') return null
    const m = sourcePath.match(/\/notebook\/([0-9a-fA-F-]{10,})/)
    return m ? m[1] : null
  }

  const shouldNotify = (rpcids) => {
    if (!rpcids) return false
    const list = String(rpcids).split(',').map(s => s.trim()).filter(Boolean)
    return list.some(id => MUTATION_RPC_IDS.has(id))
  }

  const emit = (type, payload, source = 'minddock') => {
    try {
      window.postMessage({ source, type, payload }, '*')
    } catch (_) {}
  }

  const updateContext = (patch) => {
    const ctx = window[CONTEXT_KEY] || {}
    const next = { ...ctx }
    Object.keys(patch || {}).forEach((k) => {
      const v = patch[k]
      if (v !== undefined && v !== null && v !== '') {
        next[k] = v
      }
    })
    next.updatedAt = Date.now()
    window[CONTEXT_KEY] = next
    return next
  }

  const readBodyFields = (body) => {
    if (!body) return { at: null, fReq: null }
    try {
      if (typeof body === 'string') {
        const params = new URLSearchParams(body)
        return { at: params.get('at'), fReq: params.get('f.req') }
      }
      if (body instanceof URLSearchParams) {
        return { at: body.get('at'), fReq: body.get('f.req') }
      }
      if (body instanceof FormData) {
        return { at: body.get('at'), fReq: body.get('f.req') }
      }
    } catch (_) {}
    return { at: null, fReq: null }
  }

  const observeRequest = (url, body) => {
    try {
      const u = new URL(url, window.location.href)
      if (!u.hostname.includes('notebooklm.google.com')) return
      if (!u.pathname.includes('/_/LabsTailwindUi/data/batchexecute')) return

      const rpcids = u.searchParams.get('rpcids') || ''
      const sourcePath = u.searchParams.get('source-path') || ''
      const notebookId = parseNotebookIdFromSourcePath(sourcePath)
      const { at } = readBodyFields(body)

      updateContext({
        fSid: u.searchParams.get('f.sid'),
        bl: u.searchParams.get('bl'),
        hl: u.searchParams.get('hl'),
        sourcePath,
        notebookId,
        at
      })

      if (shouldNotify(rpcids)) {
        emit('NOTEBOOKLM_RPC_MUTATION', { rpcids, sourcePath, notebookId, ts: Date.now() }, 'minddock')
      }
    } catch (_) {}
  }

  const parseBatchexecute = (raw) => {
    const cleaned = String(raw || '').replace(/^\)\]\}'\s*/, '').trim()
    if (!cleaned) return []
    const nodes = []
    for (const line of cleaned.split('\n')) {
      const t = line.trim()
      if (!t.startsWith('[') && !t.startsWith('{')) continue
      try {
        nodes.push(JSON.parse(t))
      } catch (_) {}
    }
    return nodes
  }

  const findRpcCalls = (node, out) => {
    if (!Array.isArray(node)) return
    if (node.length >= 3 && node[0] === 'wrb.fr' && typeof node[1] === 'string') {
      out.push({ rpcId: node[1], payload: node[2] })
    }
    for (const child of node) findRpcCalls(child, out)
  }

  const extractStudioItems = (payload) => {
    const items = []
    const seen = new Set()
    const walk = (node) => {
      if (!Array.isArray(node)) return
      if (node.length >= 2 && typeof node[0] === 'string' && typeof node[1] === 'string') {
        const id = node[0]
        const title = node[1]
        if (UUID_RE.test(id) && title.trim().length > 1 && !seen.has(id)) {
          seen.add(id)
          items.push({
            id,
            title: title.trim(),
            type: typeof node[2] === 'number' ? node[2] : null
          })
        }
      }
      for (const child of node) walk(child)
    }
    walk(payload)
    return items
  }

  const handleResponse = (url, raw) => {
    try {
      const nodes = parseBatchexecute(raw)
      if (!nodes.length) return

      const calls = []
      nodes.forEach(n => findRpcCalls(n, calls))
      if (!calls.length) return

      const ctx = window[CONTEXT_KEY] || {}
      let items = []
      for (const call of calls) {
        if (call.rpcId !== STUDIO_RPC_ID) continue
        let payload = call.payload
        if (typeof payload === 'string') {
          try { payload = JSON.parse(payload) } catch (_) {}
        }
        items = items.concat(extractStudioItems(payload))
      }

      if (items.length > 0) {
        emit('MINDDOCK_STUDIO_LIST_UPDATED', {
          items,
          notebookId: ctx.notebookId || parseNotebookIdFromSourcePath(ctx.sourcePath || '')
        })
        emit('MINDDOCK_STUDIO_LIST_UPDATED', {
          items,
          notebookId: ctx.notebookId || parseNotebookIdFromSourcePath(ctx.sourcePath || '')
        }, 'minddock')
      }
    } catch (_) {}
  }

  // Hook fetch
  const originalFetch = window.fetch
  if (typeof originalFetch === 'function') {
    window.fetch = function (input, init) {
      try {
        const url = typeof input === 'string' ? input : (input && input.url)
        if (url) observeRequest(url, init && init.body)
        if (input instanceof Request && url) {
          try {
            input.clone().text().then((text) => observeRequest(url, text)).catch(() => {})
          } catch (_) {}
        }
      } catch (_) {}

      const p = originalFetch.apply(this, arguments)
      try {
        const url = typeof input === 'string' ? input : (input && input.url)
        if (url && url.includes('/_/LabsTailwindUi/data/batchexecute')) {
          p.then((resp) => {
            try {
              resp.clone().text().then((raw) => handleResponse(url, raw)).catch(() => {})
            } catch (_) {}
          })
        }
      } catch (_) {}
      return p
    }
  }

  // Hook XHR
  const XHROpen = XMLHttpRequest.prototype.open
  const XHRSend = XMLHttpRequest.prototype.send

  XMLHttpRequest.prototype.open = function (method, url) {
    try { this.__md_url = url } catch (_) {}
    return XHROpen.apply(this, arguments)
  }

  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (this.__md_url) observeRequest(this.__md_url, body)
    } catch (_) {}

    try {
      this.addEventListener('loadend', () => {
        try {
          if (this.__md_url && typeof this.responseText === 'string') {
            handleResponse(this.__md_url, this.responseText)
          }
        } catch (_) {}
      }, { once: true })
    } catch (_) {}

    return XHRSend.apply(this, arguments)
  }
})()
