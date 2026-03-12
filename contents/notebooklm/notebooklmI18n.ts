export type NotebookLmLanguage = "pt" | "en"

export interface DeleteUiCopy {
  deleteActionLabel: string
  notebookMissing: string
  selectAtLeastOne: string
  genericDeleteError: string
  deletingMessage: (count: number) => string
  deletedMessage: (count: number) => string
  unmappedMessage: (count: number) => string
  failedMessage: (count: number) => string
  noneDeletedMessage: string
  confirmAriaLabel: string
  confirmTitle: string
  confirmBody: (count: number) => string
  cancelLabel: string
  confirmDeleteLabel: string
  deletingLabel: string
  toastTitle: string
  closeToastLabel: string
}

export interface SourceFilterUiCopy {
  filterLabels: Record<"ALL" | "PDF" | "GDOC" | "WEB" | "TEXT" | "AUDIO" | "IMAGE" | "YOUTUBE", string>
  searchPlaceholder: string
  refreshGoogleDocsTitle: string
  sourceGroupsTitle: string
  groupsSearchPlaceholder: string
  noSavedGroups: string
  groupCountLabel: (count: number) => string
  deleteGroupTitle: string
  deleteGroupAriaLabel: (groupName: string) => string
  saveViewButton: string
  saveDialogAriaLabel: string
  saveDialogTitle: string
  saveDialogPlaceholder: string
  saveDialogCancel: string
  saveDialogSave: string
  suggestedGroupName: (nextIndex: number) => string
  notebookIdMissing: string
  selectAtLeastOneToSave: string
  saveGroupNameRequired: string
  saveGroupFailed: string
  groupNotFound: string
  noSourcesToApplyGroup: string
  noGroupSourcesFound: (groupName: string) => string
  groupAlreadyApplied: (groupName: string) => string
  delete: DeleteUiCopy
}

export interface SourceDownloadUiCopy {
  downloadButtonTitle: string
  panelToggleTitle: string
  modalAriaLabel: string
  modalTitle: string
  modalSubtitleSelection: string
  modalSubtitlePreview: string
  closeNoticeAriaLabel: string
  sourceFilterPlaceholder: string
  formatLabelMarkdown: string
  formatLabelText: string
  formatLabelPdf: string
  formatLabelDocx: string
  selectAllLabel: string
  loadingBackendSources: string
  noSourcesForFilter: string
  sourceKindDocument: string
  sourceKindYoutube: string
  previewSkippedLabel: (count: number) => string
  loadingPreview: string
  noPreviewAvailable: string
  previewTextareaPlaceholder: string
  previewButton: string
  backButton: string
  downloadButton: (count: number) => string
  downloadRunningButton: string
  toastTitleUpdatingSources: string
  toastTitlePreviewSources: string
  toastTitleDownloadingSources: string
  toastTitleDownloadSources: string
  fallbackToastError: string
  fallbackToastSuccess: string
  fallbackToastRunning: string
  routeNotebookMissing: string
  backendListFailed: string
  backendNoSources: string
  loadSourcesFailed: string
  openModalFailed: string
  syncNotebookMissing: string
  syncRefreshing: string
  syncDetecting: string
  syncFailed: string
  syncSuccess: (syncedCount: number, total: number) => string
  syncNoLinkedDocs: string
  syncNoSources: string
  fetchNotebookMissing: string
  fetchSourceContentsFailed: string
  noContentForPreview: string
  selectAtLeastOnePreview: string
  previewBuildDataFailed: string
  previewOpenFailed: string
  noSourcesAvailablePreview: string
  previewSupportedOnly: string
  noPreviewContentReturned: string
  previewBuildFailed: string
  preparingDownloadFiles: string
  selectAtLeastOneDownload: string
  selectedNoDownloadContent: string
  downloadSuccess: string
  preparingProgress: (current: number, total: number) => string
  zippingFiles: string
  downloadFailed: string
  untitledSource: string
  defaultGoogleDocTitle: string
  fallbackSummaryTitle: string
  fallbackSummarySourcePrefix: string
  fallbackSummaryTypePrefix: string
  fallbackSummaryDetected: string
  fallbackSummaryUnavailable: string
  fallbackSummaryTip: string
  fallbackTypeDocument: string
  fallbackTypeYoutube: string
  pdfBuildFailed: string
  pdfEmptyResponse: string
}

export interface ResourceViewerUiCopy {
  previewLabel: string
  closePreviewAriaLabel: string
  imageAlt: string
  pdfIframeTitle: string
  unsupportedFormatMessage: string
}

export function resolveNotebookLmLanguage(): NotebookLmLanguage {
  try {
    const htmlLang = String(document.documentElement?.lang ?? "").toLowerCase()
    const browserLang = String(navigator.language ?? "").toLowerCase()
    const browserLangs = Array.isArray(navigator.languages)
      ? navigator.languages.map((item) => String(item ?? "").toLowerCase()).join(" ")
      : ""
    const merged = `${htmlLang} ${browserLang} ${browserLangs}`
    if (/\bpt\b|pt-|pt_/.test(merged)) {
      return "pt"
    }
  } catch {
    // Default fallback handled below.
  }
  return "en"
}

export function resolveSourceFilterUiCopy(language = resolveNotebookLmLanguage()): SourceFilterUiCopy {
  if (language === "pt") {
    return {
      filterLabels: {
        ALL: "Todos",
        PDF: "PDF",
        GDOC: "GDocs",
        WEB: "Web",
        TEXT: "Texto",
        AUDIO: "Audio",
        IMAGE: "Imagens",
        YOUTUBE: "YouTube"
      },
      searchPlaceholder: "Filtrar fontes...",
      refreshGoogleDocsTitle: "Atualizar fontes do Google Docs",
      sourceGroupsTitle: "Grupos de fontes",
      groupsSearchPlaceholder: "Visualizacoes da pesquisa...",
      noSavedGroups: "Nenhum grupo salvo para este notebook.",
      groupCountLabel: (count) => `${count} fonte(s)`,
      deleteGroupTitle: "Excluir grupo",
      deleteGroupAriaLabel: (groupName) => `Excluir grupo ${groupName}`,
      saveViewButton: "Salvar visualizacao",
      saveDialogAriaLabel: "Salvar visualizacao atual",
      saveDialogTitle: "Salvar visualizacao atual",
      saveDialogPlaceholder: 'Exemplo: "Meus trabalhos de pesquisa"',
      saveDialogCancel: "Cancelar",
      saveDialogSave: "Salvar",
      suggestedGroupName: (nextIndex) => `Grupo ${nextIndex}`,
      notebookIdMissing: "Notebook ID nao encontrado.",
      selectAtLeastOneToSave: "Selecione pelo menos 1 fonte para salvar no grupo.",
      saveGroupNameRequired: "Informe um nome para o grupo.",
      saveGroupFailed: "Nao foi possivel salvar o grupo com as fontes atuais.",
      groupNotFound: "Grupo nao encontrado.",
      noSourcesToApplyGroup: "Nenhuma fonte disponivel para aplicar o grupo.",
      noGroupSourcesFound: (groupName) =>
        `Nenhuma fonte do grupo "${groupName}" foi encontrada nesta lista.`,
      groupAlreadyApplied: (groupName) => `Grupo "${groupName}" ja estava aplicado.`,
      delete: {
        deleteActionLabel: "Excluir fontes selecionadas",
        notebookMissing: "Notebook ID nao encontrado para excluir fontes.",
        selectAtLeastOne: "Selecione pelo menos 1 fonte para excluir.",
        genericDeleteError: "Falha ao excluir fontes selecionadas.",
        deletingMessage: (count) => `Excluindo ${count} fonte(s)...`,
        deletedMessage: (count) => `${count} fonte(s) excluida(s).`,
        unmappedMessage: (count) => `${count} nao mapeada(s).`,
        failedMessage: (count) => `${count} com falha.`,
        noneDeletedMessage: "Nenhuma fonte foi excluida.",
        confirmAriaLabel: "Confirmar exclusao de fontes",
        confirmTitle: "Confirmar exclusao",
        confirmBody: (count) => `Excluir ${count} fonte(s) selecionada(s)? Essa acao nao pode ser desfeita.`,
        cancelLabel: "Cancelar",
        confirmDeleteLabel: "Excluir",
        deletingLabel: "Excluindo...",
        toastTitle: "Excluir fontes",
        closeToastLabel: "Fechar aviso"
      }
    }
  }

  return {
    filterLabels: {
      ALL: "All",
      PDF: "PDF",
      GDOC: "GDocs",
      WEB: "Web",
      TEXT: "Text",
      AUDIO: "Audio",
      IMAGE: "Images",
      YOUTUBE: "YouTube"
    },
    searchPlaceholder: "Search sources...",
    refreshGoogleDocsTitle: "Refresh Google Docs sources",
    sourceGroupsTitle: "Source groups",
    groupsSearchPlaceholder: "Search saved views...",
    noSavedGroups: "No saved group for this notebook.",
    groupCountLabel: (count) => `${count} source(s)`,
    deleteGroupTitle: "Delete group",
    deleteGroupAriaLabel: (groupName) => `Delete group ${groupName}`,
    saveViewButton: "Save view",
    saveDialogAriaLabel: "Save current view",
    saveDialogTitle: "Save current view",
    saveDialogPlaceholder: 'Example: "My research sources"',
    saveDialogCancel: "Cancel",
    saveDialogSave: "Save",
    suggestedGroupName: (nextIndex) => `Group ${nextIndex}`,
    notebookIdMissing: "Notebook ID not found.",
    selectAtLeastOneToSave: "Select at least 1 source to save in the group.",
    saveGroupNameRequired: "Enter a name for the group.",
    saveGroupFailed: "Could not save the group with current sources.",
    groupNotFound: "Group not found.",
    noSourcesToApplyGroup: "No available source to apply the group.",
    noGroupSourcesFound: (groupName) => `No source from "${groupName}" was found in this list.`,
    groupAlreadyApplied: (groupName) => `Group "${groupName}" is already applied.`,
    delete: {
      deleteActionLabel: "Delete selected sources",
      notebookMissing: "Notebook ID not found to delete sources.",
      selectAtLeastOne: "Select at least 1 source to delete.",
      genericDeleteError: "Failed to delete selected sources.",
      deletingMessage: (count) => `Deleting ${count} source(s)...`,
      deletedMessage: (count) => `${count} source(s) deleted.`,
      unmappedMessage: (count) => `${count} not mapped.`,
      failedMessage: (count) => `${count} failed.`,
      noneDeletedMessage: "No sources were deleted.",
      confirmAriaLabel: "Confirm source deletion",
      confirmTitle: "Confirm deletion",
      confirmBody: (count) => `Delete ${count} selected source(s)? This action cannot be undone.`,
      cancelLabel: "Cancel",
      confirmDeleteLabel: "Delete",
      deletingLabel: "Deleting...",
      toastTitle: "Delete sources",
      closeToastLabel: "Close notification"
    }
  }
}

export function resolveSourceDownloadUiCopy(language = resolveNotebookLmLanguage()): SourceDownloadUiCopy {
  if (language === "pt") {
    return {
      downloadButtonTitle: "Baixar fontes",
      panelToggleTitle: "Mostrar ou ocultar painel de filtros",
      modalAriaLabel: "Baixar fontes",
      modalTitle: "Baixar fontes",
      modalSubtitleSelection: "Selecione as fontes para baixar ou abra a previa para revisar antes do download.",
      modalSubtitlePreview: "Revise e edite cada fonte antes de baixar.",
      closeNoticeAriaLabel: "Fechar aviso",
      sourceFilterPlaceholder: "Filtrar fontes...",
      formatLabelMarkdown: "Markdown",
      formatLabelText: "Texto",
      formatLabelPdf: "PDF",
      formatLabelDocx: "Word",
      selectAllLabel: "todos",
      loadingBackendSources: "Carregando fontes do backend...",
      noSourcesForFilter: "Nenhuma fonte encontrada para este filtro.",
      sourceKindDocument: "Documento",
      sourceKindYoutube: "YouTube",
      previewSkippedLabel: (count) =>
        `${count} fonte(s) selecionada(s) nao suportam previa e serao baixadas sem edicao.`,
      loadingPreview: "Carregando previa das fontes...",
      noPreviewAvailable: "Nenhuma pre-visualizacao disponivel para as fontes selecionadas.",
      previewTextareaPlaceholder: "Conteudo da fonte para ajustar antes de baixar.",
      previewButton: "Previa",
      backButton: "Voltar",
      downloadButton: (count) => `Download ${count}`,
      downloadRunningButton: "Baixando...",
      toastTitleUpdatingSources: "Atualizando fontes",
      toastTitlePreviewSources: "Previa de fontes",
      toastTitleDownloadingSources: "Baixando fontes",
      toastTitleDownloadSources: "Baixar fontes",
      fallbackToastError: "Nao foi possivel concluir a operacao.",
      fallbackToastSuccess: "Operacao concluida com sucesso.",
      fallbackToastRunning: "Processando...",
      routeNotebookMissing: "Notebook ID nao encontrado na rota atual do NotebookLM.",
      backendListFailed: "Falha ao listar fontes do notebook.",
      backendNoSources: "Nenhuma fonte foi retornada pelo backend.",
      loadSourcesFailed: "Falha ao carregar as fontes do notebook.",
      openModalFailed: "Falha ao abrir o modal de download.",
      syncNotebookMissing: "Notebook ID nao encontrado para sincronizacao de Google Docs.",
      syncRefreshing: "Atualizando fontes do Google Docs...",
      syncDetecting: "Detectando fontes do Google Docs antes da atualizacao...",
      syncFailed: "Falha ao sincronizar fontes do Google Docs.",
      syncSuccess: (syncedCount, total) => `${syncedCount} de ${total} fonte(s) sincronizada(s).`,
      syncNoLinkedDocs:
        "Nenhuma fonte com vinculo Google Docs encontrada.\nPara sincronizar: no Google Drive, clique com botao direito -> Abrir com Google Docs para converter, depois reimporte no NotebookLM.",
      syncNoSources: "Nenhuma fonte para sincronizar.",
      fetchNotebookMissing: "Notebook ID nao encontrado.",
      fetchSourceContentsFailed: "Falha ao buscar conteudo das fontes.",
      noContentForPreview:
        "Nenhum conteudo disponivel para pre-visualizar. Verifique se esta em uma pagina de notebook do NotebookLM.",
      selectAtLeastOnePreview: "Selecione pelo menos 1 fonte para abrir a previa.",
      previewBuildDataFailed: "Nao foi possivel montar os dados da fonte para previa.",
      previewOpenFailed: "Falha ao abrir a previa da fonte.",
      noSourcesAvailablePreview: "Nenhuma fonte disponivel para pre-visualizar.",
      previewSupportedOnly:
        "A previa aceita apenas Google Docs/Sheets/Slides, PDF, paginas web e transcricoes de YouTube.",
      noPreviewContentReturned: "Nenhum conteudo foi retornado para pre-visualizacao.",
      previewBuildFailed: "Nao foi possivel montar a pre-visualizacao.",
      preparingDownloadFiles: "Preparando arquivos para download...",
      selectAtLeastOneDownload: "Selecione pelo menos 1 fonte para baixar.",
      selectedNoDownloadContent: "Nenhuma fonte selecionada possui conteudo disponivel para download.",
      downloadSuccess: "Download concluido com sucesso...",
      preparingProgress: (current, total) => `Preparando ${current}/${total}...`,
      zippingFiles: "Compactando arquivos...",
      downloadFailed: "O download nao pode ser concluido.",
      untitledSource: "Fonte sem titulo",
      defaultGoogleDocTitle: "Google Doc",
      fallbackSummaryTitle: "Resumo estruturado da fonte",
      fallbackSummarySourcePrefix: "Fonte",
      fallbackSummaryTypePrefix: "Tipo",
      fallbackSummaryDetected: "Conteudo detectado da interface do NotebookLM:",
      fallbackSummaryUnavailable: "Conteudo bruto indisponivel pela API no momento.",
      fallbackSummaryTip: "Dica: use a opcao de previa para revisar o conteudo antes de baixar.",
      fallbackTypeDocument: "Documento",
      fallbackTypeYoutube: "YouTube",
      pdfBuildFailed: "Falha ao gerar PDF no pipeline offscreen.",
      pdfEmptyResponse: "Resposta de PDF vazia no pipeline offscreen."
    }
  }

  return {
    downloadButtonTitle: "Download sources",
    panelToggleTitle: "Show or hide the filters panel",
    modalAriaLabel: "Download sources",
    modalTitle: "Download sources",
    modalSubtitleSelection: "Select sources to download or open preview to review before download.",
    modalSubtitlePreview: "Review and edit each source before download.",
    closeNoticeAriaLabel: "Close notification",
    sourceFilterPlaceholder: "Filter sources...",
    formatLabelMarkdown: "Markdown",
    formatLabelText: "Text",
    formatLabelPdf: "PDF",
    formatLabelDocx: "Word",
    selectAllLabel: "all",
    loadingBackendSources: "Loading backend sources...",
    noSourcesForFilter: "No source found for this filter.",
    sourceKindDocument: "Document",
    sourceKindYoutube: "YouTube",
    previewSkippedLabel: (count) =>
      `${count} selected source(s) do not support preview and will be downloaded without editing.`,
    loadingPreview: "Loading source preview...",
    noPreviewAvailable: "No preview available for selected sources.",
    previewTextareaPlaceholder: "Source content to adjust before download.",
    previewButton: "Preview",
    backButton: "Back",
    downloadButton: (count) => `Download ${count}`,
    downloadRunningButton: "Downloading...",
    toastTitleUpdatingSources: "Updating sources",
    toastTitlePreviewSources: "Source preview",
    toastTitleDownloadingSources: "Downloading sources",
    toastTitleDownloadSources: "Download sources",
    fallbackToastError: "Could not complete this action.",
    fallbackToastSuccess: "Action completed successfully.",
    fallbackToastRunning: "Processing...",
    routeNotebookMissing: "Notebook ID was not found in the current NotebookLM route.",
    backendListFailed: "Failed to list notebook sources.",
    backendNoSources: "No sources were returned by the backend.",
    loadSourcesFailed: "Failed to load notebook sources.",
    openModalFailed: "Failed to open the download modal.",
    syncNotebookMissing: "Notebook ID was not found for Google Docs sync.",
    syncRefreshing: "Refreshing Google Docs sources...",
    syncDetecting: "Detecting Google Docs sources before refresh...",
    syncFailed: "Failed to sync Google Docs sources.",
    syncSuccess: (syncedCount, total) => `${syncedCount} of ${total} source(s) synced.`,
    syncNoLinkedDocs:
      "No source with Google Docs link found.\nTo sync: in Google Drive, right click -> Open with Google Docs to convert, then reimport in NotebookLM.",
    syncNoSources: "No source to sync.",
    fetchNotebookMissing: "Notebook ID was not found.",
    fetchSourceContentsFailed: "Failed to fetch source content.",
    noContentForPreview:
      "No content available to preview. Make sure you are on a NotebookLM notebook page.",
    selectAtLeastOnePreview: "Select at least 1 source to open preview.",
    previewBuildDataFailed: "Could not prepare source data for preview.",
    previewOpenFailed: "Failed to open source preview.",
    noSourcesAvailablePreview: "No available source to preview.",
    previewSupportedOnly:
      "Preview supports only Google Docs/Sheets/Slides, PDF, web pages, and YouTube transcripts.",
    noPreviewContentReturned: "No content was returned for preview.",
    previewBuildFailed: "Could not build the preview.",
    preparingDownloadFiles: "Preparing files for download...",
    selectAtLeastOneDownload: "Select at least 1 source to download.",
    selectedNoDownloadContent: "No selected source has available content to download.",
    downloadSuccess: "Download completed successfully...",
    preparingProgress: (current, total) => `Preparing ${current}/${total}...`,
    zippingFiles: "Compressing files...",
    downloadFailed: "The download could not be completed.",
    untitledSource: "Untitled source",
    defaultGoogleDocTitle: "Google Doc",
    fallbackSummaryTitle: "Structured source summary",
    fallbackSummarySourcePrefix: "Source",
    fallbackSummaryTypePrefix: "Type",
    fallbackSummaryDetected: "Content detected from NotebookLM interface:",
    fallbackSummaryUnavailable: "Raw content is currently unavailable from the API.",
    fallbackSummaryTip: "Tip: use preview mode to review content before downloading.",
    fallbackTypeDocument: "Document",
    fallbackTypeYoutube: "YouTube",
    pdfBuildFailed: "Failed to render PDF in offscreen pipeline.",
    pdfEmptyResponse: "Empty PDF response from offscreen pipeline."
  }
}

export function resolveResourceViewerUiCopy(language = resolveNotebookLmLanguage()): ResourceViewerUiCopy {
  if (language === "pt") {
    return {
      previewLabel: "Previa",
      closePreviewAriaLabel: "Fechar previa",
      imageAlt: "Previa",
      pdfIframeTitle: "Previa PDF",
      unsupportedFormatMessage: "Previa nao disponivel para este formato de arquivo."
    }
  }

  return {
    previewLabel: "Preview",
    closePreviewAriaLabel: "Close preview",
    imageAlt: "Preview",
    pdfIframeTitle: "PDF preview",
    unsupportedFormatMessage: "Preview is not available for this file format."
  }
}
