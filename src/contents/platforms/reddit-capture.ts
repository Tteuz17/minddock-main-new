export type RedditCaptureMode = "post_only" | "post_with_comments"

export interface RedditCaptureMessage {
  role: "user"
  content: string
}

export interface RedditCaptureResult {
  mode: RedditCaptureMode
  sourceUrl: string
  subreddit: string | null
  postId: string | null
  postTitle: string | null
  messages: RedditCaptureMessage[]
}

export interface RedditCaptureOptions {
  includeComments?: boolean
  expandComments?: boolean
  maxComments?: number
  maxCharsPerMessage?: number
  skipDeletedComments?: boolean
}

interface PostSnapshot {
  title: string
  body: string
  author: string
  subreddit: string
  permalink: string
  createdAt: string
  postId: string
}

interface CommentSnapshot {
  id: string
  author: string
  body: string
  depth: number
  permalink: string
  createdAt: string
  score: string
}

interface RedditCaptureConfig {
  postRoots: readonly string[]
  postTitle: readonly string[]
  postBody: readonly string[]
  postAuthor: readonly string[]
  postSubreddit: readonly string[]
  postLink: readonly string[]
  commentRoots: readonly string[]
  commentBody: readonly string[]
  commentAuthor: readonly string[]
  commentLink: readonly string[]
  postNoiseTokens: readonly string[]
  postNoiseRegex: readonly RegExp[]
  commentUiTokens: readonly string[]
  expandTokens: readonly string[]
  collapseTokens: readonly string[]
}

const CAPTURE_CONFIG: RedditCaptureConfig = {
  postRoots: ["shreddit-post", "article[data-testid='post-container']", "main article", ".thing.link"],
  postTitle: ["h1[id^='post-title-']", "h1[data-testid='post-title']", "[post-title]", ".title"],
  postBody: [
    ".md.text-14-scalable",
    "shreddit-post-text-body",
    "[data-post-click-location='text-body']",
    ".usertext-body",
    ".md"
  ],
  postAuthor: ["[data-testid='post_author_link']", "a[href*='/user/']", "a[href*='/u/']", "[author]"],
  postSubreddit: ["[data-testid='subreddit-name']", "a[href^='/r/']", "[subreddit-prefixed-name]"],
  postLink: ["a[href*='/comments/']", "[permalink]"],
  commentRoots: ["shreddit-comment", "div[data-testid='comment']", ".thing.comment", ".Comment"],
  commentBody: ["[slot='comment']", "shreddit-comment-content", "[data-testid='comment'] [data-click-id='text']", ".md"],
  commentAuthor: ["[data-testid='comment_author_link']", "a[href*='/user/']", "a[href*='/u/']", "[author]"],
  commentLink: ["a[href*='/comments/']", "[permalink]"],
  postNoiseTokens: [
    "sugestao para voce",
    "porque voce ja visitou esta comunidade antes",
    "porque voce visitou esta comunidade antes",
    "porque voce demonstrou interesse nessa comunidade",
    "because you've shown interest in a similar community",
    "because youve shown interest in a similar community",
    "because you visited this community before",
    "suggested for you"
  ],
  postNoiseRegex: [
    /because you.?ve shown interest in (a )?(similar )?community/iu,
    /porque voce (ja )?visitou esta comunidade antes/iu,
    /porque voce demonstrou interesse nessa comunidade/iu,
    /because you visited this community before/iu,
    /sugest(?:a|ã)o para voc(?:e|ê)/iu
  ],
  commentUiTokens: ["reply", "share", "award", "save", "responder", "compartilhar", "salvar"],
  expandTokens: [
    "view more comments",
    "load more comments",
    "more replies",
    "continue this thread",
    "view more replies",
    "ver mais comentarios",
    "carregar mais comentarios",
    "mais respostas",
    "continuar esta conversa",
    "mostrar mais comentarios"
  ],
  collapseTokens: ["hide", "collapse", "less", "ocultar", "recolher", "mostrar menos"]
}

function tidy(value: unknown): string {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function fold(value: unknown): string {
  return tidy(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function foldNoiseKey(value: unknown): string {
  return fold(value)
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function asAbsoluteUrl(raw: string): string {
  const value = tidy(raw)
  if (!value) {
    return ""
  }

  if (/^https?:\/\//i.test(value)) {
    return value
  }

  try {
    return new URL(value, window.location.origin).toString()
  } catch {
    return ""
  }
}

function permalinkPostId(url: string): string {
  const match = tidy(url).match(/\/comments\/([a-z0-9]+)\//i)
  return match?.[1] ?? ""
}

function permalinkCommentId(url: string): string {
  const match = tidy(url).match(/\/comments\/[a-z0-9]+\/[^/]+\/([a-z0-9]+)\//i)
  return match?.[1] ?? ""
}

function visible(node: Element): node is HTMLElement {
  if (!(node instanceof HTMLElement) || !node.isConnected) {
    return false
  }

  if (node.hidden || node.getAttribute("aria-hidden") === "true") {
    return false
  }

  const style = window.getComputedStyle(node)
  if (style.display === "none" || style.visibility === "hidden") {
    return false
  }

  const rect = node.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function queryUnique(selectors: readonly string[]): Element[] {
  const out: Element[] = []
  const seen = new Set<Element>()

  for (const selector of selectors) {
    const nodes = Array.from(document.querySelectorAll(selector))
    for (const node of nodes) {
      if (seen.has(node)) {
        continue
      }
      seen.add(node)
      out.push(node)
    }
  }

  return out
}

function firstText(root: Element, selectors: readonly string[]): string {
  for (const selector of selectors) {
    const node = root.querySelector(selector)
    if (!node) {
      continue
    }

    const text = tidy((node as HTMLElement).innerText || node.textContent || "")
    if (text) {
      return text
    }
  }

  return ""
}

function firstAttr(root: Element, attrs: readonly string[]): string {
  for (const attr of attrs) {
    const value = tidy(root.getAttribute(attr))
    if (value) {
      return value
    }
  }

  return ""
}

function firstPermalink(root: Element, selectors: readonly string[]): string {
  for (const selector of selectors) {
    const node = root.querySelector(selector)
    if (!node) {
      continue
    }

    const href = tidy((node as HTMLAnchorElement).getAttribute("href"))
    if (!href) {
      continue
    }

    const absolute = asAbsoluteUrl(href)
    if (absolute) {
      return absolute
    }
  }

  return ""
}

function scorePostCandidate(root: Element): number {
  let score = 0

  if (tidy(root.getAttribute("post-title"))) {
    score += 4
  }

  if (tidy(root.getAttribute("permalink")) || root.querySelector("a[href*='/comments/']")) {
    score += 3
  }

  if (tidy(root.getAttribute("subreddit-prefixed-name")) || root.querySelector("a[href^='/r/']")) {
    score += 2
  }

  if (firstText(root, CAPTURE_CONFIG.postTitle)) {
    score += 2
  }

  if (firstText(root, CAPTURE_CONFIG.postBody)) {
    score += 1
  }

  if (visible(root)) {
    score += 1
  }

  return score
}

function choosePrimaryPost(seed?: Element | null): Element | null {
  if (seed && seed.isConnected) {
    return seed
  }

  const candidates = queryUnique(CAPTURE_CONFIG.postRoots)
  if (candidates.length === 0) {
    return null
  }

  const currentPost = permalinkPostId(window.location.href)
  if (currentPost) {
    for (const candidate of candidates) {
      const direct = tidy(candidate.getAttribute("permalink"))
      const permalink = direct || firstPermalink(candidate, CAPTURE_CONFIG.postLink)
      const postId = permalinkPostId(permalink)
      if (postId && postId === currentPost) {
        return candidate
      }
    }
  }

  const ranked = candidates
    .map((candidate) => ({ candidate, score: scorePostCandidate(candidate) }))
    .sort((left, right) => right.score - left.score)

  return ranked[0]?.candidate ?? null
}

function sanitizePostBody(raw: string): string {
  const rows = tidy(raw)
    .split("\n")
    .map((line) => tidy(line))
    .filter(Boolean)

  const cleaned: string[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    const lowered = fold(row)
    const key = foldNoiseKey(row)
    if (!key) {
      continue
    }

    if (CAPTURE_CONFIG.postNoiseTokens.some((token) => key.includes(token) || token.includes(key))) {
      continue
    }

    if (/porque voce .*comunidade antes/iu.test(key) || /because you .*community/iu.test(key)) {
      continue
    }

    if (CAPTURE_CONFIG.postNoiseRegex.some((pattern) => pattern.test(lowered))) {
      continue
    }

    if (lowered === "spoiler" || lowered === "nsfw" || lowered === "promoted" || lowered === "patrocinado") {
      continue
    }

    if (/^\d+\s*(upvotes?|votes?|votos?)$/iu.test(lowered)) {
      continue
    }

    if (/^\d+\s*(comments?|comentarios?)$/iu.test(lowered)) {
      continue
    }

    if (seen.has(lowered)) {
      continue
    }

    seen.add(lowered)
    cleaned.push(row)
  }

  return tidy(cleaned.join("\n"))
}

function extractPost(root: Element): PostSnapshot | null {
  const titleAttr = tidy(root.getAttribute("post-title"))
  const titleText = firstText(root, CAPTURE_CONFIG.postTitle)
  const title = titleAttr || titleText

  let author = tidy(root.getAttribute("author")) || firstText(root, CAPTURE_CONFIG.postAuthor)
  author = author.replace(/^u\//i, "").trim() || "Unknown Author"

  let subreddit = tidy(root.getAttribute("subreddit-prefixed-name")) || firstText(root, CAPTURE_CONFIG.postSubreddit)
  subreddit = subreddit.replace(/^\/?r\//i, "r/").trim()

  const rawPermalink = tidy(root.getAttribute("permalink"))
  const permalink = asAbsoluteUrl(rawPermalink) || firstPermalink(root, CAPTURE_CONFIG.postLink) || window.location.href

  const createdAt =
    tidy(root.getAttribute("created-timestamp")) ||
    tidy(root.getAttribute("data-timestamp")) ||
    tidy(root.getAttribute("datetime"))

  const directBodies = [tidy(root.getAttribute("data-full-content")), tidy(root.getAttribute("data-content")), tidy(root.getAttribute("content"))].filter(
    Boolean
  )

  let body = directBodies[0] ?? ""
  if (!body) {
    for (const selector of CAPTURE_CONFIG.postBody) {
      const node = root.querySelector(selector)
      if (!node) {
        continue
      }

      const text = tidy((node as HTMLElement).innerText || node.textContent || "")
      if (text.length > body.length) {
        body = text
      }
    }
  }

  if (!body) {
    const mediaFlags: string[] = []
    if (root.querySelector("video")) {
      mediaFlags.push("[Video]")
    }
    if (root.querySelector("img")) {
      mediaFlags.push("[Image]")
    }
    if (root.querySelector("gallery-carousel, shreddit-gallery")) {
      mediaFlags.push("[Gallery]")
    }
    body = mediaFlags.join("\n")
  }

  body = sanitizePostBody(body)

  if (!title && !body) {
    return null
  }

  return {
    title: title || "(Untitled post)",
    body,
    author,
    subreddit,
    permalink,
    createdAt,
    postId: permalinkPostId(permalink)
  }
}

function sanitizeComment(raw: string): string {
  const lines = tidy(raw).split("\n")
  const filtered = lines.filter((line) => {
    const normalized = fold(line)
    if (!normalized) {
      return false
    }

    if (CAPTURE_CONFIG.commentUiTokens.includes(normalized)) {
      return false
    }

    return true
  })

  return tidy(filtered.join("\n"))
}

function extractComment(root: Element): CommentSnapshot | null {
  let author = tidy(root.getAttribute("author")) || firstText(root, CAPTURE_CONFIG.commentAuthor)
  author = author.replace(/^u\//i, "").trim() || "unknown"

  let body = ""
  for (const selector of CAPTURE_CONFIG.commentBody) {
    const node = root.querySelector(selector)
    if (!node) {
      continue
    }

    const text = sanitizeComment((node as HTMLElement).innerText || node.textContent || "")
    if (text.length > body.length) {
      body = text
    }
  }

  if (!body) {
    body = sanitizeComment((root as HTMLElement).innerText || root.textContent || "")
  }

  if (!body) {
    return null
  }

  const permalink = asAbsoluteUrl(tidy(root.getAttribute("permalink"))) || firstPermalink(root, CAPTURE_CONFIG.commentLink)

  const id =
    permalinkCommentId(permalink) ||
    tidy(root.getAttribute("thingid")) ||
    tidy(root.getAttribute("data-fullname")) ||
    tidy(root.getAttribute("id")) ||
    `${author}:${body.slice(0, 40)}`

  const depthRaw = tidy(root.getAttribute("depth")) || tidy(root.getAttribute("data-depth"))
  const depth = Number.isFinite(Number(depthRaw)) ? Number(depthRaw) : 0

  const createdAt = tidy(root.getAttribute("created-timestamp")) || tidy(root.getAttribute("datetime"))
  const score = tidy(root.getAttribute("score")) || tidy(root.getAttribute("data-score"))

  return {
    id,
    author,
    body,
    depth,
    permalink,
    createdAt,
    score
  }
}

function canExpandControl(node: Element): boolean {
  if (!(node instanceof HTMLElement) || node.hidden) {
    return false
  }

  if (!visible(node)) {
    return false
  }

  const label = fold(node.innerText || node.textContent || "")
  if (!label) {
    return false
  }

  const hasPositive = CAPTURE_CONFIG.expandTokens.some((token) => label.includes(token))
  const hasNegative = CAPTURE_CONFIG.collapseTokens.some((token) => label.includes(token))
  if (!hasPositive || hasNegative) {
    return false
  }

  return !(node as HTMLButtonElement).disabled
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function expandComments(passLimit = 6, clickLimit = 10): Promise<void> {
  for (let pass = 0; pass < passLimit; pass++) {
    const controls = Array.from(document.querySelectorAll("button, a[role='button']")).filter(canExpandControl)
    if (controls.length === 0) {
      break
    }

    let clicked = 0
    for (const control of controls) {
      if (clicked >= clickLimit) {
        break
      }

      ;(control as HTMLElement).click()
      clicked += 1
      await wait(90)
    }

    if (clicked === 0) {
      break
    }

    await wait(500)
  }
}

function commentScopeRoot(): Element {
  return (
    document.querySelector("shreddit-comment-tree") ||
    document.querySelector("[data-testid='comments-page']") ||
    document.querySelector("#siteTable") ||
    document.body
  )
}

function collectDomComments(scope: Element, options: Required<RedditCaptureOptions>): CommentSnapshot[] {
  const nodes: Element[] = []
  for (const selector of CAPTURE_CONFIG.commentRoots) {
    nodes.push(...Array.from(scope.querySelectorAll(selector)))
  }

  const out: CommentSnapshot[] = []
  const seen = new Set<string>()

  for (const node of nodes) {
    const comment = extractComment(node)
    if (!comment) {
      continue
    }

    const normalized = fold(comment.body)
    if (options.skipDeletedComments && (normalized === "[deleted]" || normalized === "[removed]")) {
      continue
    }

    if (!comment.body || comment.body.length < 2) {
      continue
    }

    if (seen.has(comment.id)) {
      continue
    }

    seen.add(comment.id)
    out.push(comment)

    if (out.length >= options.maxComments) {
      break
    }
  }

  return out
}

function mergeComments(target: CommentSnapshot[], incoming: CommentSnapshot[], max: number): void {
  const seen = new Set(target.map((item) => item.id))

  for (const item of incoming) {
    if (target.length >= max) {
      return
    }

    if (seen.has(item.id)) {
      continue
    }

    seen.add(item.id)
    target.push(item)
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null
}

function normalizeAuthor(value: unknown): string {
  const output = tidy(value).replace(/^u\//i, "").trim()
  return output || "unknown"
}

function normalizeCommentId(value: unknown, fallback: string): string {
  const id = tidy(value)
  if (!id) {
    return fallback
  }

  return id.replace(/^t1_/i, "") || fallback
}

function flattenJsonComments(payload: unknown, fallbackPermalink: string, options: Required<RedditCaptureOptions>): CommentSnapshot[] {
  const out: CommentSnapshot[] = []
  const seen = new Set<string>()

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const entry of node) {
        walk(entry)
      }
      return
    }

    const container = asRecord(node)
    if (!container) {
      return
    }

    const kind = tidy(container.kind).toLowerCase()
    const data = asRecord(container.data)
    if (!data) {
      return
    }

    if (kind === "t1") {
      const body = sanitizeComment(String(data.body ?? ""))
      const normalized = fold(body)
      if (!body) {
        return
      }

      if (options.skipDeletedComments && (normalized === "[deleted]" || normalized === "[removed]")) {
        return
      }

      const author = normalizeAuthor(data.author)
      const permalink = asAbsoluteUrl(String(data.permalink ?? "")) || fallbackPermalink
      const fallbackId = `${author}:${body.slice(0, 40)}`
      const id = normalizeCommentId(data.id ?? data.name ?? permalinkCommentId(permalink), fallbackId)
      if (!id || seen.has(id)) {
        return
      }

      seen.add(id)

      const depthNumber = Number(data.depth)
      const depth = Number.isFinite(depthNumber) ? depthNumber : 0

      const createdUtc = Number(data.created_utc)
      const createdAt = Number.isFinite(createdUtc) && createdUtc > 0 ? String(Math.round(createdUtc * 1000)) : ""

      out.push({
        id,
        author,
        body,
        depth,
        permalink,
        createdAt,
        score: tidy(data.score)
      })
    }

    const children = Array.isArray(data.children) ? data.children : []
    for (const child of children) {
      walk(child)
    }

    const replies = data.replies
    if (replies && typeof replies === "object") {
      walk(replies)
    }
  }

  walk(payload)
  return out.slice(0, options.maxComments)
}

async function fetchJsonComments(permalink: string, options: Required<RedditCaptureOptions>): Promise<CommentSnapshot[]> {
  const basePermalink = asAbsoluteUrl(permalink) || window.location.href

  try {
    const url = new URL(basePermalink, window.location.origin)
    let path = url.pathname
    if (!path.endsWith("/")) {
      path += "/"
    }
    if (!path.endsWith(".json")) {
      path += ".json"
    }

    url.pathname = path
    url.searchParams.set("raw_json", "1")
    url.searchParams.set("limit", String(Math.min(500, Math.max(100, options.maxComments))))
    url.searchParams.set("depth", "10")
    url.searchParams.set("sort", "top")

    const response = await fetch(url.toString(), {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json,text/plain,*/*"
      }
    })

    if (!response.ok) {
      return []
    }

    const payload = (await response.json()) as unknown
    return flattenJsonComments(payload, basePermalink, options)
  } catch {
    return []
  }
}

async function collectComments(permalink: string, options: Required<RedditCaptureOptions>): Promise<CommentSnapshot[]> {
  const merged: CommentSnapshot[] = []
  mergeComments(merged, await fetchJsonComments(permalink, options), options.maxComments)

  const maxPasses = Math.max(4, Math.min(10, Math.ceil(options.maxComments / 24) + 2))
  let stableCycles = 0
  let lastCount = merged.length

  for (let pass = 0; pass < maxPasses; pass++) {
    if (options.expandComments) {
      await expandComments(pass === 0 ? 5 : 2, pass === 0 ? 14 : 8)
    }

    mergeComments(merged, collectDomComments(commentScopeRoot(), options), options.maxComments)

    if (merged.length >= options.maxComments) {
      break
    }

    if (merged.length === lastCount) {
      stableCycles += 1
    } else {
      stableCycles = 0
      lastCount = merged.length
    }

    if (stableCycles >= 2) {
      break
    }

    await wait(350)
  }

  return merged.slice(0, options.maxComments)
}

function splitByMaxChars(entries: string[], maxChars: number): string[] {
  const out: string[] = []
  let buffer = ""

  for (const entry of entries) {
    const candidate = buffer ? `${buffer}\n\n${entry}` : entry
    if (candidate.length <= maxChars) {
      buffer = candidate
      continue
    }

    if (buffer) {
      out.push(buffer)
    }

    if (entry.length <= maxChars) {
      buffer = entry
      continue
    }

    let cursor = 0
    while (cursor < entry.length) {
      out.push(entry.slice(cursor, cursor + maxChars))
      cursor += maxChars
    }

    buffer = ""
  }

  if (buffer) {
    out.push(buffer)
  }

  return out
}

function formatTimestamp(value: string): string {
  const normalized = tidy(value)
  if (!normalized) {
    return ""
  }

  const parsed = new Date(normalized)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleString("pt-BR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    })
  }

  const numeric = Number(normalized)
  if (Number.isFinite(numeric) && numeric > 0) {
    const fromUnix = new Date(numeric > 1_000_000_000_000 ? numeric : numeric * 1000)
    if (!Number.isNaN(fromUnix.getTime())) {
      return fromUnix.toLocaleString("pt-BR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      })
    }
  }

  return normalized
}

function makePostMessage(post: PostSnapshot): RedditCaptureMessage {
  const body = sanitizePostBody(post.body) || "Sem conteudo textual detectado."
  const postedAt = formatTimestamp(post.createdAt)
  const metadata = [
    post.subreddit ? `Subreddit: ${post.subreddit}` : "",
    post.author ? `Autor: u/${post.author}` : "",
    postedAt ? `Publicado em: ${postedAt}` : "",
    post.permalink ? `Link: ${post.permalink}` : ""
  ].filter(Boolean)

  return {
    role: "user",
    content: tidy([`Titulo: ${post.title}`, ...metadata, "", body].join("\n"))
  }
}

function makeCommentMessages(comments: CommentSnapshot[], options: Required<RedditCaptureOptions>): RedditCaptureMessage[] {
  if (comments.length === 0) {
    return []
  }

  const lines = comments.map((comment, index) => {
    const block = [`Comentario ${index + 1}`, `Usuario: u/${comment.author}`, comment.body, "----------------------------------------"]
    return tidy(block.join("\n"))
  })

  return splitByMaxChars(lines, options.maxCharsPerMessage).map((chunk) => ({
    role: "user",
    content: chunk
  }))
}

export async function captureRedditPostOrThread(
  seedPostNode?: Element | null,
  options: RedditCaptureOptions = {}
): Promise<RedditCaptureResult | null> {
  const normalized: Required<RedditCaptureOptions> = {
    includeComments: options.includeComments ?? true,
    expandComments: options.expandComments ?? true,
    maxComments: options.maxComments ?? 180,
    maxCharsPerMessage: options.maxCharsPerMessage ?? 14_000,
    skipDeletedComments: options.skipDeletedComments ?? true
  }

  const postRoot = choosePrimaryPost(seedPostNode)
  if (!postRoot) {
    return null
  }

  const post = extractPost(postRoot)
  if (!post) {
    return null
  }

  const messages: RedditCaptureMessage[] = [makePostMessage(post)]
  let comments: CommentSnapshot[] = []

  if (normalized.includeComments) {
    comments = await collectComments(post.permalink, normalized)
    if (comments.length > 0) {
      messages.push(...makeCommentMessages(comments, normalized))
    }
  }

  return {
    mode: comments.length > 0 ? "post_with_comments" : "post_only",
    sourceUrl: post.permalink || window.location.href,
    subreddit: post.subreddit || null,
    postId: post.postId || null,
    postTitle: post.title || null,
    messages
  }
}

