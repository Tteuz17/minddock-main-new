import { AuthExpiredException, ExternalServiceException, rpcClient } from "~/services/network"
import { getExternalExportRpcEndpoint } from "~/services/network/networkConfig"
import { showMindDockToast } from "../../../../contents/common/minddock-ui"

const EXTERNAL_EXPORT_RPC_ENDPOINT = getExternalExportRpcEndpoint()

function showUiSuccessToast(): void {
  showMindDockToast({
    message: "Conteudo salvo com sucesso no servico externo.",
    variant: "success",
    timeoutMs: 2400
  })
}

function showUiWarningToast(message: string): void {
  showMindDockToast({
    message: String(message ?? "").trim(),
    variant: "info",
    timeoutMs: 3200
  })
}

function showUiErrorToast(message: string): void {
  showMindDockToast({
    message: String(message ?? "").trim(),
    variant: "error",
    timeoutMs: 3400
  })
}

export async function handleExportToExternalService(contentData: unknown): Promise<void> {
  try {
    await rpcClient.executeRpcCall(EXTERNAL_EXPORT_RPC_ENDPOINT, {
      contentData
    })
    showUiSuccessToast()
  } catch (error) {
    const errorMessage = error instanceof Error ? String(error.message ?? "").trim() : ""

    if (error instanceof AuthExpiredException || errorMessage === "MISSING_AUTH_TOKENS") {
      showUiWarningToast("Sessao desconectada. Por favor, abra o servico em uma nova aba para reconectar.")
      return
    }

    if (error instanceof ExternalServiceException || errorMessage.startsWith("RPC_CALL_FAILED")) {
      showUiErrorToast("Falha ao salvar no servidor destino.")
      return
    }

    showUiErrorToast("Falha inesperada ao salvar no servidor destino.")
  }
}
