# MindDock - Fase 1 (Base MV3 + Auth + Token + RPC)

## Estrutura (Fase 1)

```text
minddock-main/
  background.ts
  contents/
    notebooklm-interceptor.ts
    notebooklm-listener.ts
  src/
    background/
      auth-manager.ts
      notebook-client.ts
      notebooklm-client.ts
      router.ts
    lib/
      contracts.ts
      constants.ts
      types.ts
```

## Como buildar

1. Instale dependencias:
```bash
npm install
```
2. Build de producao:
```bash
npm run build
```
3. Desenvolvimento:
```bash
npm run dev
```

## Como carregar a extensao

1. Abra `chrome://extensions`.
2. Ative `Modo do desenvolvedor`.
3. Clique em `Carregar sem compactacao`.
4. Selecione a pasta gerada pelo Plasmo (`build/chrome-mv3-prod` no build, ou pasta de dev do Plasmo).

## Testes de aceite (4 fluxos)

1. Login Supabase:
- Envie `MINDDOCK_CMD_AUTH_SIGN_IN` com `{ email, password }`.
- Esperado: `{ success: true, payload: { isAuthenticated: true, user } }`.
- Em seguida `MINDDOCK_CMD_AUTH_GET_STATUS` deve retornar `isAuthenticated: true`.
- Envie `MINDDOCK_CMD_AUTH_SIGN_OUT` e confirme `isAuthenticated: false`.

2. Captura de tokens NotebookLM:
- Abra `https://notebooklm.google.com` e gere trafego (listar notebooks/fontes).
- Verifique no `chrome.storage.local`:
  - `nexus_at_token`
  - `nexus_bl_token`
  - `nexus_token_expires_at`

3. RPC de notebooks:
- Envie `MINDDOCK_CMD_GET_NOTEBOOKS`.
- Esperado: lista real (nao mock) em `payload`.

4. RPC de fontes:
- Envie `MINDDOCK_CMD_GET_NOTEBOOK_SOURCES` com `{ notebookId }`.
- Esperado: fontes reais com `id` e `title`.

## Diferencas arquiteturais vs legado

- Contratos fixos centralizados em `src/lib/contracts.ts` (acoes, chaves, evento seguro).
- Router com resposta padronizada em todos comandos: `{ success, payload?, error? }` (com alias `data` para compatibilidade).
- Auth bridge isolado em `auth-manager.ts` com `initializeSession`, `signIn`, `signOut`, `getCurrentUser`.
- Captura de token com handshake seguro (`MINDDOCK_SECURE_TOKEN_BROADCAST` + `md-v1-secure`) e validacao de origem/source no listener.
- Novo cliente RPC dedicado da Fase 1 (`notebook-client.ts`) com `executeRpc` generico, parser robusto e erro HTTP estruturado (`rpcId`, `status`).
