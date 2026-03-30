# Sistema de Captura do Modal de Estudio (MindDock)

Data da auditoria: 2026-03-30  
Base auditada: codigo local em `d:\Extnsãao MIND\minddock-main`

## Objetivo deste documento

Este guia descreve, ponta a ponta, como o modal de exportacao do Estudio funciona hoje:

- captura de IDs no DOM
- RPC no background (`gArtLc` / `cFji9`)
- extracao de titulo, conteudo, tipo, URL e MIME
- classificacao texto vs asset
- download por tipo (mp4, pdf, png, etc)
- fluxo obrigatorio de Slides em PDF nativo (todas as paginas)
- fallback, cache, dedupe e criterios de seguranca
- playbook de recuperacao para voltar ao estado estavel

---

## 1) Visao geral da arquitetura

Fluxo principal:

1. O botao do Estudio e injetado pelo content script `notebooklm-injector`.
2. `StudioExportButton` abre o modal, coleta os itens do DOM e tenta carregar cache local por conta.
3. Para enriquecer os itens, `StudioExportButton` envia `MINDDOCK_FETCH_STUDIO_ARTIFACTS` para o background.
4. O background chama RPCs do NotebookLM:
   - `gArtLc` (lista)
   - `cFji9` (conteudo)
   - fallback com `gArtLc` alternativo
5. O parser do background extrai e normaliza:
   - `id`, `title`, `type`, `content`, `url`, `mimeType`, `kind`
6. O modal decide exportacao por item:
   - texto (`md` / `txt` / `docx` / `pdf`)
   - asset binario (video/audio/imagem/pdf)
7. Para Slides, o fluxo e estrito: precisa baixar PDF nativo valido (`%PDF-`), sem fallback para formato errado.
8. Se houver varios arquivos, gera ZIP; se for 1 arquivo, baixa direto.

Arquivos nucleares:

- `contents/notebooklm/StudioExportButton.tsx`
- `src/background/studioArtifacts.ts`
- `src/background/MessageRouter.ts`
- `src/background/api/GoogleRPC.ts`
- `src/background/storage/TokenStorage.ts`
- `src/contents/token-relay.ts`
- `src/contents/secure-bridge-listener.ts`
- `src/background/services/offscreen-pdf-service.ts`
- `src/lib/offscreen-pdf-listener.ts`
- `src/lib/pdf-build.ts`
- `src/contents/notebooklm-injector.tsx`
- `contents/notebooklm/sourceDom.ts`

---

## 2) Injecao do modal e ponto de ancoragem

### 2.1 Injetor

- Arquivo: `src/contents/notebooklm-injector.tsx`
- O target `studio-export` usa:
  - `resolveHost: resolveStudioExportAnchor`
  - `render: () => <StudioExportButton />`
- Controle de ciclo de vida (anti-botao "fantasma"):
  - o host "sticky" do Studio so e mantido quando `isStudioExportModalOpen === true`
  - quando a aba/modal fecha, o root e desmontado e o launcher deixa de aparecer fora do contexto
- Referencias:
  - target: linhas ~175-180
  - import de `StudioExportButton`: linha 19

### 2.2 Anchor no DOM

- Arquivo: `contents/notebooklm/sourceDom.ts`
- `resolveStudioExportAnchor()`:
  - **primario**: resolve header do Studio com `resolveStudioPanelHeader()`
  - escolhe o botao compacto mais a direita do header via `resolveRightmostCompactHeaderActionButton()`
  - prioriza acao com semantica de fechar/recolher (`dock_to_left`, `close`, `collapse`, etc.) quando presente
  - fallback: `resolveStudioLabel()` + `resolveStudioCloseTabButton()`
  - fallback adicional: botao com icone `dock_to_left`
  - fallback final: botao compacto proximo do label `Studio` e, por ultimo, overflow
- Referencia: bloco ~2766-3120

### 2.3 Posicionamento e estilo do launcher (update 2026-03-30)

- Arquivo: `contents/notebooklm/StudioExportButton.tsx`
- Wrapper do botao:
  - `ml-auto mr-1` para encostar no lado direito do header
  - ajuste fino vertical com `marginTop: "1px"` para alinhar com icone nativo de fechar/recolher
- Botao visualmente alinhado ao padrao escuro do MindDock:
  - estado normal: fundo `#050505`, icone branco
  - estado aberto/ativo: fundo `#0a0a0a`, icone branco

---

## 3) Bootstrap do modal e coleta de IDs

Arquivo: `contents/notebooklm/StudioExportButton.tsx`

### 3.1 Coleta de IDs no DOM

Funcoes:

- `resolveStudioArtifactIdFromRow` (~722)
- `collectStudioIdsFromDom` (~764)

Heuristica:

- procura UUID em atributos de row e descendentes
- pontua melhor atributos com tokens `artifact`, `result`, `studio`, `id`
- remove notebookId da lista
- rejeita candidatos ambiguos/fracos

### 3.2 Carregamento inicial de dados

Ao abrir:

- semeia items pelo DOM (`readStudioTitlesFromDom`)
- tenta cache local por conta via `loadStudioEntriesFromStorage` (~1184)
- dispara evento de lista:
  - `window.postMessage({ source: "minddock", type: "MINDDOCK_FETCH_STUDIO_LIST" ... })` (~4893, ~5614)
- aciona armamento do interceptor de rede:
  - `STUDIO_ARM` (~4619)

### 3.3 Contexto RPC em memoria da pagina

- `resolveRpcContextFromWindow()` (~800)
- le de `window.__minddock_rpc_context`
- usa campos: `fSid`, `bl`, `hl`, `socApp`, `socPlatform`, `socDevice`, `sourcePath`, `at`

---

## 4) Contrato entre modal e background

### 4.1 Buscar artefatos

Mensagem:

- `type: "MINDDOCK_FETCH_STUDIO_ARTIFACTS"`

Payload enviado pelo modal:

- `ids: string[]`
- `notebookId?: string`
- `forceRefresh?: boolean`
- `rpcContext?: {...}`

Resposta esperada:

- `success: true/false`
- aliases de retorno:
  - `artifacts`
  - `items`
  - `payload.items`
  - `data.items`

Referencias:

- envio: `StudioExportButton.tsx` ~831-892
- roteamento: `MessageRouter.ts` ~961-996

### 4.2 Buscar binario de asset

Mensagem:

- `type: "MINDDOCK_FETCH_BINARY_ASSET"`

Payload:

- `url: string`
- `atToken?: string`
- `authUser?: string | number | null`
- `mode?: "buffer" | "download"`
- `filename?: string`

Resposta:

- modo buffer:
  - `bytesBase64`
  - `mimeType`
  - `size`
- modo download:
  - `downloaded: true`
  - `downloadId`
  - `filename`
  - `mimeType`
  - `size`

Referencias:

- envio: `StudioExportButton.tsx` ~894-980
- handler: `MessageRouter.ts` ~1165-1476

---

## 5) Pipeline RPC no background

Arquivo: `src/background/studioArtifacts.ts`

### 5.1 RPC IDs e payloads

Constantes:

- `STUDIO_LIST_RPC_ID = "gArtLc"` (linha 5)
- `STUDIO_CONTENT_RPC_ID = "cFji9"` (linha 6)
- `STUDIO_LIST_FILTER = NOT artifact.status = "ARTIFACT_STATUS_SUGGESTED"` (linha 7)

Payload builders:

- `buildListPayload(notebookId)` (linha 91)
- `buildContentPayload(notebookId)` (linha 99)
- `buildAltContentPayload(notebookId)` (linha 103)

### 5.2 Execucao da busca

Funcao central:

- `fetchStudioArtifactsByIds(ids, notebookId, options)` (linha 1422)

Passos:

1. resolve notebookId por argumento ou regex em `rpcContext.sourcePath` (`resolveNotebookId`, linha 1410)
2. tenta cache scoped por conta se `forceRefresh=false`
3. monta 3 requests paralelos:
   - `gArtLc` (context `list`)
   - `cFji9` (context `content`)
   - `gArtLc` alternativo (context `content`)
4. executa com `Promise.allSettled`
5. persiste raw RPC truncado (350k chars) em storage
6. extrai list/content, mergeia, dedupa por titulo, filtra por sinal
7. persiste cache final scoped por conta

### 5.3 Classe de transporte RPC

Arquivo: `src/background/api/GoogleRPC.ts`

- endpoint: `https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute`
- exige `at` + `bl` (erro `MISSING_AUTH` se faltar)
- inclui query params: `rpcids`, `bl`, `source-path`, `rt=c`, opcional `f.sid`, `hl`, `soc-*`, `authuser`
- envia body:
  - `f.req=[[ [rpcId, JSON.stringify(payload), null, "generic"] ]]`
  - `at=<token>`
- remove anti-hijack prefix `)]}'`
- parseia resposta em JSON quando possivel

Referencia:

- `GoogleRPC.execute` linhas ~60-166

---

## 6) Extracao de titulo, conteudo, URL, MIME e tipo

Arquivo: `src/background/studioArtifacts.ts`

### 6.1 Mapa de tipo

Mapas principais:

- `LIST_TYPE_LABELS` (linha 21)
- `CONTENT_TYPE_LABELS` (linha 39)

Tipos visuais tratados como fortes:

- `VISUAL_TYPE_CODES = {1,3,5,6,7,8,10,12,14}` (linha 51)
- `VISUAL_TYPES = {"Slides","Infographic","Mind Map","Video Overview","Audio Overview"}` (linha 53)

Excluidos de export:

- `EXCLUDED_FROM_EXPORT = {"Quiz","Data Table","Flashcards"}` (linha 55)

### 6.2 Parser de payload batchexecute

Passos:

- `parseBatchexecuteFrames`: encontra frames `wrb.fr`
- `extractPayloadsFromRawText`: filtra por `rpcId`
- `extractStudioItemsFromPayload` e `extractListItemsFromPayload`

Referencias:

- frames: ~165
- extractor raw->payload: ~1148
- list extractor: ~1103
- content extractor: ~1060

### 6.3 Selecao de campos por heuristica

Funcoes relevantes:

- `pickBestTitle` (~446)
- `pickBestContent` (~452)
- `extractOwnedText` (~585)
- `extractOwnedMedia` (~469)
- `chooseOwnedMediaForType` (~506)
- `inferTypeLabel` (~669)
- `deriveKind` (~784)

Principios:

- id preferencial por owner UUID do no
- titulo prefere string humana com score
- conteudo evita URL/mime/meta/uuid e prioriza blocos longos
- URL e MIME so entram com sinal visual forte
- Slides prioriza PDF quando presente
- fallback de tipo por URL quando sem typecode

### 6.4 Reclassificacao de Data Table

- `looksLikeDataTableContent` (~704)
- `reclassifyDataTableItem` (~767)
- converte certos falsos `Blog Post` para `Data Table` via heuristica de tabela

### 6.5 Merge, filtro e dedupe final

- merge list+content por id
- filtro por sinal util e requested ids
- dedupe por titulo normalizado (`dedupeByNormalizedTitle`, ~1384)
- permissao controlada de overflow blog post seguro

---

## 7) Classificacao final no modal (texto vs asset)

Arquivo: `contents/notebooklm/StudioExportButton.tsx`

### 7.1 URL resolvida de asset

- `resolveEntryAssetUrl` (~2952)
- examina `entry.url`, `entry.content`, JSON embutido, URLs escapadas
- remove telemetria e URLs de login/collect (`isBlockedTelemetryUrl`, ~2909)

### 7.2 Regra de visual

- `isVisualAssetEntry` (~3252)
- sinais:
  - `kind=asset`
  - mime visual (`video/*`, `audio/*`, `image/*`, `application/pdf`)
  - tipo visual por label/codigo
  - URL com sinal binario

### 7.3 Regra de exportacao binaria

- `shouldExportAsBinaryAsset` (~4092)
- retorna:
  - `ok`
  - `assetUrl`
  - `reason`

---

## 8) Download por tipo (o que vira cada formato)

### 8.1 Matriz oficial

Base em `resolveFileExtension` (background, linha 797):

- `Slides` -> `pdf`
- `Infographic` -> `png`
- `Mind Map` -> `png`
- `Video Overview` -> `mp4`
- `Audio Overview` -> `mp4`
- default texto -> `md`

No modal, `resolveAssetExtension` (~3856) refina por URL/MIME:

- extrai extensao da URL quando possivel
- detecta hints de `googlevideo` e `mime=...`
- fallback por MIME
- fallback por `type`
- ultimo fallback: `bin`

### 8.2 Video (MP4)

Caminho:

1. item classificado como binario
2. `fetchBinaryFile` chama background primeiro
3. background tenta:
   - download direto por URL candidata
   - fetch include
   - fetch include + Authorization Bearer
   - fetch include + `at` query
   - fetch anonimo
4. se 1 item so, pode usar `mode=download` direto
5. em lote, bytes vao para ZIP

Referencias:

- modal: ~3970+
- background: `MessageRouter.ts` ~1397-1465

### 8.3 Audio

Mesma trilha de binario.  
Extensao final pode sair de:

- MIME (`audio/mpeg` -> `mp3`, etc)
- URL hints
- fallback por tipo (`Audio Overview` tende a `mp4` se sem MIME forte)

### 8.4 Infographic / Mind Map (imagem)

Mesma trilha binaria.  
Geralmente sai como `png` (ou extensao extraida da URL/MIME).

### 8.5 Slides (PDF completo, todas as paginas)

Este e o fluxo mais critico.

Passos:

1. Detecta item "slides-like" (`isSlidesLikeEntryType`, ~3014)
2. tenta URL nativa no cache temporario (`nativeSlidePdfCache`, ~40)
3. se nao houver:
   - tenta abrir menu `more_vert`
   - busca botao `picture_as_pdf`
   - ativa modo capture-only
   - intercepta URL `https://contribution.usercontent.google.com/download?...`
4. baixa bytes da URL nativa
5. valida assinatura PDF (`isPdfSignature`, ~2989)
6. salva como `.pdf`

Regra de seguranca:

- se qualquer etapa falhar, NAO faz fallback para formato errado
- lanca erro duro:
  - `Slides deve ser exportado em PDF. ...`

Referencias:

- captura URL nativa: `captureNativeSlidesPdfUrlForEntry` (~2672)
- download PDF nativo: bloco ~4276-4343
- erro obrigatorio: ~4391-4401

---

## 9) Exportacao de conteudo textual

Quando item nao e binario:

- `markdown` -> bytes texto
- `text` -> bytes texto
- `docx` -> `buildDocxBytesFromText` (`src/lib/source-download.ts`)
- `pdf` -> `buildPdfBytesViaBackground` com `CMD_RENDER_PDF_OFFSCREEN`

Offscreen PDF:

1. modal chama background (`MINDDOCK_CMD_RENDER_PDF_OFFSCREEN`)
2. background usa `renderPdfBase64ViaOffscreen`
3. offscreen listener gera PDF via `buildPdfBytesFromText`
4. retorna base64

Referencias:

- modal `buildPdfBytesViaBackground`: ~3473
- router `handleRenderPdfOffscreen`: `src/background/router.ts` ~2844
- service offscreen: `src/background/services/offscreen-pdf-service.ts`
- listener offscreen: `src/lib/offscreen-pdf-listener.ts`
- render PDF: `src/lib/pdf-build.ts`

---

## 10) Empacotamento final

Funcao central:

- `buildStudioExportFiles` (~4221)

Comportamento:

- 1 arquivo:
  - download direto do blob
- varios arquivos:
  - ZIP com `buildZip`
- pode haver direct-download sem buffer quando background retornar `downloaded=true`

Fallback controlado:

- se binario falha (nao-slides), cria atalho `.url`
- se so existir `.url`, tenta download direto novamente com candidatos autenticados

---

## 11) Cache, escopo de conta e sincronizacao

### 11.1 Chaves de Studio

Bases:

- `minddock_cached_studio_items`
- `minddock_cached_studio_items_synced_at`

Escopo:

- `buildScopedStorageKey(base, accountKey)`
- `accountKey` vem de email/authuser (`buildNotebookAccountKey`)

Arquivos:

- `src/background/studioArtifacts.ts` (persist/load cache)
- `contents/notebooklm/StudioExportButton.tsx` (load local cache)
- `src/contents/secure-bridge-listener.ts` (persist vindo de bridge)

### 11.2 Tokens de sessao RPC

Pipeline:

1. script de pagina publica `MINDDOCK_INTERCEPT`
2. `token-relay` escuta e envia `TOKENS_UPDATED` ao background
3. background salva em `TokenStorage` (`notebooklm_session`)
4. `GoogleRPC` usa `at` e `bl` para RPC

Arquivos:

- `src/contents/notebooklm-interceptor.ts`
- `src/contents/token-relay.ts`
- `src/background/MessageRouter.ts` (case `TOKENS_UPDATED`)
- `src/background/storage/TokenStorage.ts`

---

## 12) Invariantes que NAO podem quebrar

1. `gArtLc` + `cFji9` devem continuar ativos no pipeline de fetch.
2. `STUDIO_LIST_FILTER` deve continuar excluindo `ARTIFACT_STATUS_SUGGESTED`.
3. `deriveKind` e regras de visual nao podem regredir para tratar asset como texto.
4. Slides devem continuar com exigencia de PDF nativo valido (`%PDF-`), sem fallback incorreto.
5. Mensagens `MINDDOCK_FETCH_STUDIO_ARTIFACTS` e `MINDDOCK_FETCH_BINARY_ASSET` precisam manter contrato backward-compatible (`payload/data/items` aliases).
6. Cache deve continuar scoped por conta (`buildScopedStorageKey`), evitando mistura entre contas.
7. Fallback `.url` so pode existir para assets nao-slides.

---

## 13) Playbook de recuperacao (quando algo quebrar)

### 13.1 Sintoma: modal abre sem conteudo

Checklist:

1. validar IDs no DOM:
   - `resolveStudioArtifactIdFromRow`
   - `collectStudioIdsFromDom`
2. validar notebookId:
   - URL contem UUID?
   - `rpcContext.sourcePath` contem UUID?
3. validar resposta background:
   - `MINDDOCK_FETCH_STUDIO_ARTIFACTS` retorna `items`?
4. validar token:
   - `TokenStorage.getTokens()` tem `at` e `bl`?

### 13.2 Sintoma: itens aparecem, mas tipo errado

Checklist:

1. checar `inferTypeLabel` e mapas de tipo
2. checar `reclassifyDataTableItem` (falso blog post)
3. checar merge list/content por id e dedupe por titulo
4. confirmar `resolvePreferredType` no modal

### 13.3 Sintoma: video/audio nao baixa

Checklist:

1. conferir URL apos `resolveEntryAssetUrl`
2. confirmar `isBlockedTelemetryUrl` nao bloqueou URL valida
3. testar fetch no background (`MINDDOCK_FETCH_BINARY_ASSET`)
4. verificar `authuser` e `at` no request
5. avaliar se caiu no fallback `.url`

### 13.4 Sintoma: Slides falhando com erro de PDF obrigatorio

Checklist critico:

1. confirmar evento `MINDDOCK_NATIVE_SLIDES_DOWNLOAD_URL` chegando no `StudioExportButton`
2. confirmar captura do menu `more_vert` -> `picture_as_pdf`
3. confirmar URL nativa `contribution.usercontent.google.com/download?...`
4. confirmar bytes com assinatura `%PDF-`
5. se nao houver emissor da URL nativa ativo, o fluxo de Slides quebra por design

---

## 14) Riscos de wiring observados no estado atual

Durante esta auditoria, os manifests gerados atuais (`.plasmo/...manifest` e `build/...manifest`) listam como content scripts principais para NotebookLM:

- `secure-bridge-listener`
- `token-relay`
- `notebooklm-injector`

E NAO listam diretamente:

- `src/contents/notebooklmPageHook.ts`
- `src/contents/notebooklm-interceptor.ts`
- `contents/NetworkTrafficInterceptor.ts` / `src/contents/NetworkTrafficInterceptor.ts`

Impacto potencial:

1. eventos de `MINDDOCK_FETCH_STUDIO_LIST` / `MINDDOCK_STUDIO_LIST_UPDATED` podem nao ter produtor ativo
2. captura de URL nativa de Slides (`MINDDOCK_NATIVE_SLIDES_DOWNLOAD_URL`) pode nao ocorrer
3. pipeline `MINDDOCK_INTERCEPT` -> `TOKENS_UPDATED` pode depender de outro mecanismo nao evidente no manifesto

Conclusao pratica:

- a exportacao atual depende fortemente do caminho background RPC (`MINDDOCK_FETCH_STUDIO_ARTIFACTS`)
- qualquer refactor deve validar explicitamente se os hooks de pagina realmente estao no bundle ativo

---

## 15) Mapa rapido de funcoes criticas

### Modal / Conteudo

- `contents/notebooklm/StudioExportButton.tsx`
  - `requestStudioArtifacts` (~831)
  - `requestBackgroundBinaryAsset` (~894)
  - `captureNativeSlidesPdfUrlForEntry` (~2672)
  - `resolveEntryAssetUrl` (~2952)
  - `isVisualAssetEntry` (~3252)
  - `buildStudioExportFiles` (~4221)
  - `hydrateEntriesWithViewerContent` (~5702)
  - `executeExport` (~5788)

### Background Studio

- `src/background/studioArtifacts.ts`
  - `fetchStudioArtifactsByIds` (~1422)
  - `extractStudioItemFromNode` (~835)
  - `inferTypeLabel` (~669)
  - `deriveKind` (~784)
  - `resolveFileExtension` (~797)

### Background Router

- `src/background/MessageRouter.ts`
  - `STUDIO_FETCH_MESSAGE` case (~961)
  - `STUDIO_BINARY_FETCH_MESSAGE` case (~998)
  - `handleStudioBinaryFetch` (~1165)
  - `TOKENS_UPDATED` case (~849)

### RPC Transport

- `src/background/api/GoogleRPC.ts`
  - `execute` (~60)

### Offscreen PDF

- `src/background/services/offscreen-pdf-service.ts`
- `src/lib/offscreen-pdf-listener.ts`
- `src/lib/pdf-build.ts`

### Anchor / Injetor (UI Studio)

- `contents/notebooklm/sourceDom.ts`
  - `resolveStudioExportAnchor` (~3068)
  - `resolveStudioPanelHeader` (~2807)
  - `resolveRightmostCompactHeaderActionButton` (~2766)
  - `resolveStudioCloseTabButton` (~2803+)
- `src/contents/notebooklm-injector.tsx`
  - `mountTargets` com `stickyStudioHost` condicionado por `isStudioExportModalOpen` (~336-352)

---

## 16) Procedimento de restauracao para "estado perfeito"

Quando alguem alterar esse sistema, use esta ordem:

1. Garantir wiring de scripts ativos no build (manifest).
2. Garantir token/cookie context funcionando (`at` + `bl` + `authuser`).
3. Validar fetch de artefatos com IDs reais (`gArtLc` + `cFji9`).
4. Validar parser e classificacao:
   - 1 item textual longo
   - 1 video
   - 1 audio
   - 1 infographic
   - 1 mind map
   - 1 slide
5. Validar download por tipo:
   - video/audio -> arquivo binario reproduzivel
   - image -> imagem valida
   - slides -> PDF com assinatura `%PDF-`
6. Validar export texto (`md`, `txt`, `docx`, `pdf offscreen`).
7. Validar lote + zip e cenario de fallback `.url`.
8. Validar cache por conta (troca de conta nao pode misturar dados).

Se todos os passos passarem, o sistema esta funcional e recuperado.

---

## 17) Diagramas de sequencia (estado atual)

### 17.1 Sequencia principal de exportacao

```text
[NotebookLM DOM]
   -> [StudioExportButton]
      coleta IDs (DOM) + tenta cache local scoped
   -> sendMessage: MINDDOCK_FETCH_STUDIO_ARTIFACTS

[Background MessageRouter]
   -> fetchStudioArtifactsByIds
      -> GoogleRPC(gArtLc list)
      -> GoogleRPC(cFji9 content)
      -> GoogleRPC(gArtLc alt content)
      -> merge + dedupe + classify + cache scoped
   <- items normalizados

[StudioExportButton]
   -> hydrate de texto no viewer (quando necessario)
   -> decide por item: texto vs asset
   -> para texto: md/txt/docx/pdf(offscreen)
   -> para asset: fetch binary background-first
   -> se N>1: ZIP
   -> se N=1: download direto
```

### 17.2 Sequencia de download binario (nao-slides)

```text
[StudioExportButton]
   -> MINDDOCK_FETCH_BINARY_ASSET (url, at, authuser, mode)

[Background]
   -> tenta direct download por URL candidata
   -> se nao: fetch credentials include
   -> se nao: include + Authorization Bearer at
   -> se nao: include + at na query
   -> se nao: fetch anonimo

Resultado:
   A) sucesso buffer -> bytesBase64 para content script
   B) sucesso download -> downloaded=true + downloadId
   C) falha -> content script cai em fallback .url (nao-slides)
```

### 17.3 Sequencia de Slides (PDF nativo obrigatorio)

```text
[StudioExportButton]
   -> identifica entry slides-like
   -> tenta URL nativa em cache (TTL)
   -> se vazio: abre menu more_vert e aciona picture_as_pdf em capture-only

[Page Hook ativo]
   -> intercepta URL contribution.usercontent.google.com/download?...
   -> postMessage MINDDOCK_NATIVE_SLIDES_DOWNLOAD_URL

[StudioExportButton]
   -> recebe URL nativa
   -> fetchBinaryFile(mode=buffer, filename=.pdf)
   -> valida assinatura bytes "%PDF-"
   -> salva arquivo .pdf

Se falhar qualquer etapa:
   -> throw: "Slides deve ser exportado em PDF. ..."
   -> sem fallback para formato errado
```

### 17.4 Sequencia de tokens e contexto RPC

```text
[Page Main World Interceptor]
   -> captura at/bl/authuser/accountEmail de fetch/xhr
   -> postMessage MINDDOCK_INTERCEPT

[token-relay content script]
   -> envia TOKENS_UPDATED ao background

[Background MessageRouter]
   -> tokenStorage.saveTokens(notebooklm_session)

[GoogleRPC.execute]
   -> le tokenStorage (at + bl)
   -> monta batchexecute com rpcids/bl/source-path/authuser
```

---

## 18) Rebuild do zero (ordem recomendada)

Use esta ordem para reimplementar do zero sem regressao:

1. Contratos e tipos
   - definir mensagens:
     - `MINDDOCK_FETCH_STUDIO_ARTIFACTS`
     - `MINDDOCK_FETCH_BINARY_ASSET`
     - `MINDDOCK_CMD_RENDER_PDF_OFFSCREEN`
   - definir modelo de item:
     - `id, title, type, content, url, mimeType, kind`

2. Injetor e ancoragem UI
   - montar `StudioExportButton` no `notebooklm-injector`
   - resolver anchor confiavel (`resolveStudioExportAnchor`)

3. Captura de IDs no DOM
   - implementar scanner de UUID por atributos com score
   - excluir notebookId da URL/sourcePath

4. Pipeline de tokens
   - page interceptor -> `MINDDOCK_INTERCEPT`
   - relay -> `TOKENS_UPDATED`
   - background -> persistencia segura (`TokenStorage`)

5. RPC base
   - implementar `GoogleRPC.execute`
   - exigir `at` + `bl`
   - suportar contexto: `source-path`, `f.sid`, `hl`, `soc-*`, `authuser`

6. Captura de artefatos de Studio
   - implementar `fetchStudioArtifactsByIds`
   - chamar:
     - `gArtLc` list
     - `cFji9` content
     - `gArtLc` fallback content
   - parsear `wrb.fr` e extrair payload por rpcId

7. Heuristica de extracao
   - titulo: melhor candidato humano
   - conteudo: texto longo nao-URL
   - URL/MIME: apenas com sinal visual forte
   - tipo: mapa por typeCode + fallback por texto/URL
   - kind: `text` vs `asset`

8. Regras de exportacao
   - texto -> `md/txt/docx/pdf`
   - asset -> bytes binarios via background
   - multiarquivos -> zip

9. Slides nativo
   - capturar URL nativa `contribution.usercontent.../download?...`
   - obrigar assinatura `%PDF-`
   - sem fallback incorreto

10. Cache e escopo por conta
    - usar `buildNotebookAccountKey` + `buildScopedStorageKey`
    - armazenar e ler cache por conta para nao misturar dados

11. Observabilidade
    - logs de decisao por etapa (RPC, classificacao, download, slides)
    - codigos de erro claros para recovery

12. Validacao final
    - executar checklist da secao 19

---

## 19) Checklist de validacao e aceite (comandos + logs)

### 19.1 Validacao estatica do codigo

No terminal do repo:

```powershell
rg -n "MINDDOCK_FETCH_STUDIO_ARTIFACTS|MINDDOCK_FETCH_BINARY_ASSET" src/background/MessageRouter.ts contents/notebooklm/StudioExportButton.tsx
rg -n "STUDIO_LIST_RPC_ID|STUDIO_CONTENT_RPC_ID|fetchStudioArtifactsByIds" src/background/studioArtifacts.ts
rg -n "Slides deve ser exportado em PDF|isPdfSignature|MINDDOCK_NATIVE_SLIDES_DOWNLOAD_URL" contents/notebooklm/StudioExportButton.tsx
rg -n "CMD_RENDER_PDF_OFFSCREEN|renderPdfBase64ViaOffscreen" src/background/router.ts src/background/services/offscreen-pdf-service.ts
rg -n "buildScopedStorageKey|buildNotebookAccountKey" src/background/studioArtifacts.ts contents/notebooklm/StudioExportButton.tsx src/contents/secure-bridge-listener.ts
```

Resultado esperado:

- todas as buscas retornam ocorrencias reais
- sem ocorrencia faltante nas funcoes criticas

### 19.2 Validacao de wiring no build

```powershell
Get-Content build/chrome-mv3-prod/manifest.json -Raw
```

Conferir:

- `notebooklm-injector` presente
- `token-relay` presente
- `secure-bridge-listener` presente
- se hooks de pagina forem obrigatorios no seu fluxo (ex.: lista nativa studio/slides), garantir que estejam ativos por content script ou injecao equivalente

### 19.3 Validacao runtime no browser (manual)

1. Abrir NotebookLM com extensao carregada e navegar ate a aba/painel do Studio.
2. Confirmar que o launcher do MindDock fica no header do Studio ao lado do icone de fechar/recolher (nao centralizado).
3. Fechar/recolher a aba do Studio e confirmar que o launcher nao fica "vazando" fora do contexto.
4. Abrir o modal de Studio pelo launcher.
5. Confirmar que lista de itens aparece no modal.
6. Exportar 1 item textual em `markdown`.
7. Exportar 1 item visual (video/audio/imagem).
8. Exportar 1 item Slides.
9. Exportar lote misto (texto + visuais).

Logs esperados (console/background):

- `[MindDock][BG] fetch studio ids: ...`
- `[studioArtifacts] list ... content ... merged ...`
- `[MindDock][StudioBinaryFetch][CS] request ...`
- `[MindDock][BG][StudioBinaryFetch] success ...` ou `direct-download-success`
- para Slides:
  - `[MindDock][Slides] trying native download url`
  - `[MindDock][Slides] saved native multi-page pdf`

Nao pode ocorrer em fluxo feliz de Slides:

- `Slides deve ser exportado em PDF. ...`

### 19.4 Matriz minima de aceite por tipo

1. Texto (Blog Post/Study Guide/Briefing/FAQ)
   - exporta em `md`/`txt`/`docx`/`pdf` sem transformar em URL-only
2. Video Overview
   - sai como arquivo reproduzivel (`.mp4` esperado na maioria dos casos)
3. Audio Overview
   - sai como arquivo de audio/video container valido
4. Infographic/Mind Map
   - sai como imagem valida (`png` preferencial)
5. Slides
   - sai em `.pdf` valido
   - abre em leitor PDF
   - sem fallback para `.url` no caminho feliz
6. Lote misto
   - gera `.zip` com todos os arquivos esperados

### 19.5 Criterio de aceite final ("estado perfeito")

Considere o sistema restaurado quando:

1. todos os comandos de 19.1 passarem
2. wiring do build estiver correto para o fluxo desejado
3. matriz 19.4 passar 100%
4. logs de erro critico nao aparecerem no caminho feliz
5. troca de conta nao misturar cache de Studio

---

## 20) Definicao de pronto para manutencao futura

Antes de mergear qualquer alteracao nesse sistema:

1. rodar checklist 19.1 e 19.4
2. validar especialmente Slides PDF nativo
3. revisar `resolvePreferredType`, `deriveKind` e `isVisualAssetEntry`
4. confirmar que contratos de mensagem nao quebraram compatibilidade
5. atualizar este MD se qualquer regra/fluxo mudar

Se estes 5 itens forem respeitados, voce consegue alterar com seguranca e, se quebrar, restaurar rapidamente.

---

## 21) Analise de regressao em cadeia (anti-volta-ao-zero)

Esta secao foi criada para responder exatamente ao risco relatado: "corrigir um ponto, quebrar outro, e regressar ao zero".

Objetivo pratico:

- mapear onde o "lixo" entra
- explicar por que titulo/tipo ficam inconsistentes
- mostrar cadeia de impacto: se mexer em X, afeta Y e Z
- deixar um roteiro objetivo para manutencao sem regressao

### 21.1 Fontes concorrentes de dados (3 pipelines ativos)

Hoje o modal recebe dados de 3 caminhos diferentes, com regras diferentes:

1. Lista nativa da pagina (gArtLc via page hook)
   - `src/contents/notebooklmPageHook.ts` (~348-413)
   - publica `MINDDOCK_STUDIO_LIST_UPDATED`
   - consumo no modal: `contents/notebooklm/StudioExportButton.tsx` (~4907-5158)

2. Captura de rede "armada" (interceptor)
   - `src/contents/NetworkTrafficInterceptor.ts` (~1566-1682)
   - publica `STUDIO_RESULTS_UPDATED`
   - persiste cache via bridge:
     - `src/contents/secure-bridge-listener.ts` (~344-413)

3. RPC oficial no background sob demanda do modal
   - request: `contents/notebooklm/StudioExportButton.tsx` (~831-892)
   - parse/merge: `src/background/studioArtifacts.ts` (~1422-1644)

Consequencia direta:

- nao existe uma unica "fonte de verdade" em runtime
- pequenas mudancas em merge/filtro de um pipeline podem reintroduzir dado ruim vindo de outro

### 21.2 Mapa de impacto (se mexer aqui, quebra ali)

| Ponto alterado | Afeta diretamente | Regressao mais comum |
|---|---|---|
| `STUDIO_TYPE_LABELS` no modal (`StudioExportButton.tsx` ~989-1004) | texto de tipo/meta, inferencia de visual, merge de tipo | tipo errado, classificacao texto/asset errada |
| `STUDIO_TYPE_MAP` no page hook (`notebooklmPageHook.ts` ~348-363) | `typeLabel` publicado para lista | lista mostra tipo A, export usa tipo B |
| `LIST_TYPE_LABELS`/`CONTENT_TYPE_LABELS` no background (`studioArtifacts.ts` ~21-48) | parse do RPC e tipo final salvo em cache | conflitos entre lista/DOM/background |
| `cleanStudioTitle`/`extractStudioRowInfo` (`StudioExportButton.tsx` ~1255-1453) | titulo vindo do DOM | titulo lixo ou vazio, dedupe errado |
| `isValidStudioEntry`/`applyStudioFilter` (`StudioExportButton.tsx` ~3699-3739) | o que entra na lista final | lixo passa ou item valido some |
| merge do evento `MINDDOCK_STUDIO_LIST_UPDATED` (`StudioExportButton.tsx` ~4944-5158) | reconcilia titulo/tipo/id entre RPC e DOM | regressao em massa de titulo/tipo |
| `resolvePreferredType` (`StudioExportButton.tsx` ~3097-3132) | decisao final de tipo quando ha conflito | slides/video viram texto (ou vice-versa) |
| `isVisualAssetEntry`/`shouldTreatEntryAsAssetForExport` (`StudioExportButton.tsx` ~3252-3288) | rota de export (texto vs binario) | arquivo errado (ex.: URL em vez de binario) |
| pipeline `STUDIO_RESULTS_UPDATED` (`NetworkTrafficInterceptor.ts` + `secure-bridge-listener.ts`) | cache de studio por conta | lixo persistente reaparece apos refresh |
| `dedupeByNormalizedTitle` (`studioArtifacts.ts` ~1384-1397) | consolidacao final | colisoes: item some ou troca com outro |
| `overflowBlogPosts` (`studioArtifacts.ts` ~1642-1644) | retorno final ao modal | itens fora dos ids pedidos entram na tela |
| `resolveStudioExportAnchor` + `resolveStudioPanelHeader` + `resolveRightmostCompactHeaderActionButton` (`sourceDom.ts` ~2766-3120) | ancoragem do launcher no header do Studio | botao centralizado, no host errado, ou longe do fechar/recolher |
| guarda de host sticky `studio-export` no injetor (`notebooklm-injector.tsx` ~336-352) | desmontagem/visibilidade ao fechar aba Studio | botao residual ("fantasma") quando o Studio fecha |

### 21.3 Entradas provaveis de "lixo" (prioridade alta)

1. Filtro com bypass + fail-open
   - `applyStudioFilter` usa bypass quando recebe `ids` e cai para `normalized` quando filtro zera tudo.
   - arquivo: `contents/notebooklm/StudioExportButton.tsx` (~3735-3739)
   - efeito: item ruim pode sobreviver quando nao deveria.

2. Reentrada via cache fora da lista DOM atual
   - `cacheOnlyText` e `cacheOnlyVisual` podem recolocar item que nao esta na lista atual.
   - arquivo: `contents/notebooklm/StudioExportButton.tsx` (~4534-4568)
   - efeito: lixo "volta" mesmo apos filtro da lista nativa.

3. Persistencia por conta sem recorte por notebook
   - chave de cache e por conta, nao por notebook.
   - leitura com fallback default:
     - `contents/notebooklm/StudioExportButton.tsx` (~1201-1217)
   - escrita por bridge:
     - `src/contents/secure-bridge-listener.ts` (~355-361)
   - efeito: contaminacao entre cadernos dentro da mesma conta.

4. Inclusao de extras fora do conjunto pedido
   - `overflowBlogPosts` no retorno final do background.
   - arquivo: `src/background/studioArtifacts.ts` (~1642-1644)
   - efeito: itens "inesperados" entram mesmo sem id solicitado.

5. Heuristica ampla no interceptor de rede
   - extracao generica por sinais (`looksLikeTitle`, `looksLikeType`, etc.).
   - arquivo: `src/contents/NetworkTrafficInterceptor.ts` (~738-1179)
   - efeito: parser pega candidato ambiguo e persiste no cache.

### 21.4 Sobre "traducao de titulos": estado real atual

Ponto importante: hoje nao existe traducao semantica robusta de titulo de item de Studio.

O que realmente existe:

1. Mapeamento de labels de tipo (nao de titulo real)
   - page hook: `STUDIO_TYPE_MAP` (`src/contents/notebooklmPageHook.ts` ~348-363)
   - modal: `STUDIO_TYPE_LABELS` (`contents/notebooklm/StudioExportButton.tsx` ~989-1004)
   - background: `LIST_TYPE_LABELS`/`CONTENT_TYPE_LABELS` (`src/background/studioArtifacts.ts` ~21-48)

2. Escolha de titulo por prioridade de origem
   - para visual: prefere DOM/lista
   - para nao-visual: tende a manter `rpcTitle`
   - arquivo: `contents/notebooklm/StudioExportButton.tsx` (~5014-5018)

3. Deep probe de titulo com escopo limitado
   - so aplica em loading/visual por `shouldApplyDeepProbeTitle`.
   - arquivo: `contents/notebooklm/StudioExportButton.tsx` (~3296-3313)

4. Sinal de encoding inconsistente no modal
   - varios literais em `STUDIO_TYPE_LABELS`/meta com texto corrompido.
   - arquivo: `contents/notebooklm/StudioExportButton.tsx` (~989-1004, ~5047)
   - efeito: piora matching de tipo, exibicao e diagnositico humano.

Resumo:

- o problema percebido como "traducao ruim" e, na pratica, mistura de:
  - labels de tipo inconsistentes entre 3 camadas
  - priorizacao de origem de titulo por tipo
  - heuristicas de limpeza de DOM
  - encoding divergente em parte dos literais

### 21.5 Cadeias tipicas de regressao (cenarios reais)

1. "Apertei filtro para remover lixo"
   - mexe em `isLikelyChatEntry`/`looksLikeSidebarEntryTitle`/`isValidStudioEntry`
   - melhora lixo em um notebook, mas remove item valido longo em outro
   - quando vem com `ids`, bypass do filtro pode mascarar teste local
   - regressao aparece depois via cache/refresh

2. "Corrigi tipo/traducao em um arquivo so"
   - ajusta `STUDIO_TYPE_MAP` mas nao ajusta modal/background
   - resultado: lista exibe um tipo, export decide outro
   - impacta `resolvePreferredType` e classificacao asset/texto

3. "Ajustei merge de titulo para visuais"
   - mexe no bloco `MINDDOCK_STUDIO_LIST_UPDATED`
   - melhora um caso de titulo, piora outro com id incompleto
   - deep probe sobrescreve apenas parte dos itens e cria comportamento aparentemente aleatorio

4. "Ajustei cache para acelerar"
   - mudanca em bridge/cache scoped
   - lixo passa a ser persistido e reaparece apos reload
   - regressao parece "fantasma", mas vem do storage, nao do DOM atual

5. "Ajustei export de slides/video"
   - mexe em `resolvePreferredType` ou `shouldExportAsBinaryAsset`
   - item visual vira texto e cai no export textual
   - no caso de slides, quebra regra de PDF nativo obrigatorio

### 21.6 Ordem segura de manutencao (sem voltar ao zero)

1. Congelar escopo da mudanca (um eixo por vez)
   - eixo de titulo OU eixo de tipo OU eixo de filtro OU eixo de export
   - nunca mexer em dois eixos no mesmo commit.

2. Definir pipeline alvo (A/B/C) antes de editar
   - A = lista nativa
   - B = interceptor + bridge cache
   - C = RPC background
   - se nao fixar pipeline alvo, a regressao cruza camadas.

3. Validar com cache limpo e com cache sujo
   - obrigatorio testar ambos, porque boa parte da regressao so aparece com cache persistido.

4. Travar invariantes de tipo antes de tocar export
   - checar `resolvePreferredType`, `isVisualAssetEntry`, `shouldTreatEntryAsAssetForExport`.

5. So depois ajustar heuristica de limpeza de titulo
   - qualquer ajuste antes disso muda universo de dados e invalida diagnostico.

### 21.7 Matriz anti-regressao (foco em lixo + titulo + tipo)

Antes de considerar uma correcao "segura", validar:

1. Contagem base
   - lista visivel no NotebookLM vs lista no modal nao diverge de forma estrutural.

2. Itens proibidos
   - nao entram titulos tecnicos como `wXbhsf`, `studio`, `resultado do studio`.

3. Titulos validos
   - nao entram icones/labels tecnicos (`audio_magic_eraser`, etc).

4. Consistencia de tipo
   - tipo publicado por lista, tipo no modal e tipo final de export nao podem se contradizer.

5. Classificacao correta
   - visual continua visual; textual continua textual.

6. Slides
   - permanece PDF nativo obrigatorio com assinatura valida `%PDF-`.

7. Video/Audio
   - nao cai para texto por engano apos merge de tipo.

8. Cache
   - refresh nao reinjeta item que foi removido por filtro valido.

9. Troca de notebook
   - item de notebook anterior nao reaparece no notebook atual.

10. Troca de conta
   - nao mistura cache entre contas.

### 21.8 Tabela de diagnostico rapido (sintoma -> primeiro alvo)

| Sintoma | Primeiro alvo para inspecao | Provavel causa raiz |
|---|---|---|
| entrou lixo apos refresh | `secure-bridge-listener` + `loadStudioEntriesFromStorage` | cache persistido com item ambiguo |
| tipo trocou sozinho | merge `MINDDOCK_STUDIO_LIST_UPDATED` + `resolvePreferredType` | conflito de tipo entre DOM/RPC/cache |
| titulo piorou apos ajuste | `cleanStudioTitle` + `pickTitleFromLines` + deep probe | heuristica de titulo agressiva + prioridade errada |
| visual exportou como texto | `isVisualAssetEntry` / `shouldExportAsBinaryAsset` | tipo enfraquecido ou URL/mime perdido |
| slides falhou com erro de PDF | caminho nativo de slides + tipo slides-like | item nao reconhecido como slides ou URL nativa ausente |
| itens de outro notebook aparecem | cache scoped por conta sem notebook scope | reuse de cache antigo dentro da mesma conta |

### 21.9 Regra de ouro para evitar regressao em cadeia

Se for mexer:

1. escolha um eixo unico (titulo, tipo, filtro ou export)
2. congele os outros eixos
3. rode a matriz 21.7 inteira
4. so depois avance para o proximo eixo

Se esta ordem for respeitada, o risco de "arrumar 1 e quebrar 3" cai drasticamente.
