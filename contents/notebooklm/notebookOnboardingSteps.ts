export type NotebookOnboardingStepPosition = "top" | "right" | "bottom" | "left" | "center"
export type NotebookOnboardingAction =
  | "ensure_source_filters_panel"
  | "open_source_vault"
  | "close_source_vault"
  | "open_chat_export_menu"
  | "close_chat_export_menu"
  | "open_studio_modal"

export interface NotebookOnboardingStep {
  id: string
  title: string
  description: string
  target?: string
  position?: NotebookOnboardingStepPosition
  isInfoStep?: boolean
  required?: boolean
  timeoutMs?: number
  actionBefore?: NotebookOnboardingAction
}

export const NOTEBOOK_ONBOARDING_STEPS: NotebookOnboardingStep[] = [
  {
    id: "intro",
    title: "Bem-vindo ao MindDock no NotebookLM",
    description:
      "Este tour rapido mostra onde ficam os principais pontos do MindDock dentro da tela do notebook.",
    isInfoStep: true,
    position: "center"
  },
  {
    id: "source-filters-panel",
    title: "Painel de Origem das Fontes",
    description:
      "Este e o painel principal da imagem. Aqui voce filtra fontes, organiza grupos e aciona operacoes rapidas.",
    target: '[data-tour-id="source-filters-panel"]',
    position: "bottom",
    timeoutMs: 6000,
    actionBefore: "ensure_source_filters_panel"
  },
  {
    id: "source-filters-download",
    title: "Download de Fontes",
    description:
      "Este botao abre o painel de download para exportar o que voce selecionou nas fontes.",
    target: '[data-tour-id="source-filters-download-btn"]',
    position: "bottom",
    timeoutMs: 6000,
    actionBefore: "ensure_source_filters_panel"
  },
  {
    id: "source-vault-overview",
    title: "Modal de Download",
    description:
      "Este passo apresenta o modal de download como um todo: filtro, lista de fontes, selecao, previa, escolha de formato e acao final de baixar.",
    target: '[data-tour-id="source-vault-panel"]',
    position: "left",
    timeoutMs: 6000,
    actionBefore: "open_source_vault"
  },
  {
    id: "source-filters-refresh-gdocs",
    title: "Atualizar Google Docs",
    description:
      "Use este botao para sincronizar novamente as fontes de Google Docs antes de exportar ou filtrar.",
    target: '[data-tour-id="source-filters-refresh-gdocs-btn"]',
    position: "bottom",
    timeoutMs: 6000,
    actionBefore: "ensure_source_filters_panel"
  },
  {
    id: "source-filters-groups",
    title: "Grupo de Origem",
    description:
      "Neste botao de grupos voce aplica conjuntos salvos de fontes para acelerar o trabalho.",
    target: '[data-tour-id="source-filters-groups-btn"]',
    position: "bottom",
    timeoutMs: 6000,
    actionBefore: "ensure_source_filters_panel"
  },
  {
    id: "source-filters-save-group",
    title: "Salvar Grupo",
    description:
      "Depois de escolher as fontes, use Salvar grupo para guardar essa combinacao e reutilizar depois.",
    target: '[data-tour-id="source-filters-save-group-btn"]',
    position: "left",
    timeoutMs: 6000,
    actionBefore: "ensure_source_filters_panel"
  },
  {
    id: "source-filters-delete-selected",
    title: "Excluir Selecionados",
    description:
      "Este botao remove as fontes selecionadas. Tudo que estiver marcado entra na exclusao, entao revise antes de confirmar.",
    target: '[data-tour-id="source-filters-delete-selected-btn"]',
    position: "bottom",
    timeoutMs: 6000,
    actionBefore: "ensure_source_filters_panel"
  },
  {
    id: "chat-export-main",
    title: "Exportar no Bate-papo",
    description:
      "Este botao abre o popup de exportacao do bate-papo com opcoes de configuracao, integracoes e formatos.",
    target: '[data-tour-id="chat-export-main-btn"]',
    position: "bottom",
    timeoutMs: 5000,
    actionBefore: "close_source_vault"
  },
  {
    id: "chat-export-popup-overview",
    title: "Popup de Exportacao do Bate-papo",
    description:
      "Aqui e a visao completa do popup de exportacao: configuracoes, integracoes, formatos e as acoes para exportar.",
    target: '[data-tour-id="chat-export-menu"]',
    position: "left",
    timeoutMs: 6000,
    actionBefore: "open_chat_export_menu"
  },
  {
    id: "chat-export-copy",
    title: "Copia Rapida do Chat",
    description:
      "Este botao copia rapidamente o conteudo atual da conversa para voce reutilizar em outros lugares.",
    target: '[data-tour-id="chat-export-copy-btn"]',
    position: "bottom",
    timeoutMs: 5000,
    actionBefore: "close_chat_export_menu"
  },
  {
    id: "studio-export-launcher",
    title: "Botao do Estudio",
    description:
      "Esse botao abre o exportador do Estudio na propria tela, sem trocar de contexto.",
    target: '[data-tour-id="studio-export-launcher-btn"]',
    position: "bottom",
    timeoutMs: 5000,
    actionBefore: "close_chat_export_menu"
  },
  {
    id: "studio-export-panel",
    title: "Popup de Exportacao do Estudio",
    description:
      "Aqui abre o popup do Estudio com selecao de itens, filtro e formato antes da exportacao final.",
    target: '[data-tour-id="studio-export-panel"]',
    position: "left",
    timeoutMs: 6000,
    actionBefore: "open_studio_modal"
  },
  {
    id: "finish",
    title: "Tour concluido",
    description:
      "Pronto. Voce pode continuar usando o NotebookLM normalmente com os atalhos do MindDock.",
    isInfoStep: true,
    position: "center"
  }
]
