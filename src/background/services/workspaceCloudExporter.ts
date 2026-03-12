import { createPageInNotion, findDefaultParentPage } from "./notionApiClient"
import { initiateNotionLogin } from "./notionAuthManager"
import { convertHtmlToNotionBlocks, type RawTextBlock } from "./notionBlockTranslator"

interface NotionTokenVault {
  accessToken: string
  parentPageId: string
}

const NOTION_TOKEN_STORAGE_KEY = "minddock_notion_access_token"
const TARGET_PARENT_PAGE_STORAGE_KEY = "targetNotionPageId"

function normalizePageTitle(value: unknown): string {
  const title = String(value ?? "").trim()
  return title || "NotebookLM Chat Export"
}

function normalizeRawTextBlocks(inputBlocks: RawTextBlock[]): RawTextBlock[] {
  const normalizedBlocks: RawTextBlock[] = []
  for (const item of Array.isArray(inputBlocks) ? inputBlocks : []) {
    const type = String(item?.type ?? "").trim()
    const text = String(item?.text ?? "").trim()
    if (!type || !text) {
      continue
    }
    normalizedBlocks.push({ type, text })
  }
  return normalizedBlocks
}

function shouldRefreshParentPage(error: unknown): boolean {
  const normalizedError = String(error instanceof Error ? error.message : error ?? "").toLowerCase()
  return (
    normalizedError.includes("object_not_found") ||
    normalizedError.includes("could not find page with id") ||
    (normalizedError.includes("notion page creation failed (404)") && normalizedError.includes("page"))
  )
}

async function createNotionPageWithRecovery(
  accessToken: string,
  parentPageId: string,
  pageTitle: string,
  notionBlocks: ReturnType<typeof convertHtmlToNotionBlocks>
): Promise<string> {
  try {
    return await createPageInNotion(accessToken, parentPageId, pageTitle, notionBlocks)
  } catch (initialCreationError) {
    if (!shouldRefreshParentPage(initialCreationError)) {
      throw initialCreationError
    }

    const refreshedParentPageId = await findDefaultParentPage(accessToken)
    await chrome.storage.local.set({
      [TARGET_PARENT_PAGE_STORAGE_KEY]: refreshedParentPageId
    })

    try {
      return await createPageInNotion(accessToken, refreshedParentPageId, pageTitle, notionBlocks)
    } catch (retryCreationError) {
      throw new Error(
        `${String(retryCreationError instanceof Error ? retryCreationError.message : retryCreationError ?? "")} ` +
          "A pagina de destino do Notion nao esta acessivel para a conta atual. " +
          "Compartilhe pelo menos uma pagina com a integracao e tente novamente."
      )
    }
  }
}

async function readNotionTokenVault(): Promise<NotionTokenVault> {
  const resolveSnapshot = async () =>
    chrome.storage.local.get([NOTION_TOKEN_STORAGE_KEY, TARGET_PARENT_PAGE_STORAGE_KEY, "workspaceNotionToken"])

  let snapshot = await resolveSnapshot()
  let notionTokenVault = String(snapshot?.[NOTION_TOKEN_STORAGE_KEY] ?? snapshot?.workspaceNotionToken ?? "").trim()

  if (!notionTokenVault) {
    await initiateNotionLogin()
    snapshot = await resolveSnapshot()
    notionTokenVault = String(snapshot?.[NOTION_TOKEN_STORAGE_KEY] ?? snapshot?.workspaceNotionToken ?? "").trim()
  }

  if (!notionTokenVault) {
    throw new Error("Notion credentials missing")
  }

  let parentPageId = String(snapshot?.[TARGET_PARENT_PAGE_STORAGE_KEY] ?? "").trim()
  if (!parentPageId) {
    parentPageId = await findDefaultParentPage(notionTokenVault)
    await chrome.storage.local.set({
      [TARGET_PARENT_PAGE_STORAGE_KEY]: parentPageId
    })
  }

  return {
    accessToken: notionTokenVault,
    parentPageId
  }
}

export async function executeNotionPageCreation(pageTitle: string, rawTextBlocks: RawTextBlock[]): Promise<string> {
  const notionTokenVault = await readNotionTokenVault()
  const normalizedBlocks = normalizeRawTextBlocks(rawTextBlocks)
  const notionBlocks = convertHtmlToNotionBlocks(normalizedBlocks).slice(0, 100)
  if (notionBlocks.length === 0) {
    throw new Error("No structured content to export.")
  }

  return createNotionPageWithRecovery(
    notionTokenVault.accessToken,
    notionTokenVault.parentPageId,
    normalizePageTitle(pageTitle),
    notionBlocks
  )
}
