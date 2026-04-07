# Politica de Privacidade - MindDock

**Ultima atualizacao:** 07 de abril de 2026  
**Versao:** 1.1  
**Site oficial:** https://minddocklm.digital  
**Contato:** hello@minddocklm.digital

---

## 1. Introducao

Esta Politica explica como a MindDock coleta, usa, armazena, compartilha e protege dados ao utilizar a extensao Chrome e servicos associados.

Ao usar a MindDock, voce concorda com esta Politica.

---

## 2. Quais dados tratamos

### 2.1 Dados de conta MindDock

- Identificadores de conta (ex.: e-mail e id de usuario) e informacoes de assinatura (tier, status e ciclo), gerenciados no backend (Supabase).
- Finalidade: autenticacao, controle de acesso e operacao dos planos.

### 2.2 Tokens de sessao do NotebookLM (dados tecnicos de autenticacao)

- A extensao pode capturar tokens tecnicos de sessao do NotebookLM (`at`, `bl`, `authUser`, `accountEmail`) quando voce usa o NotebookLM com a extensao ativa.
- Finalidade: permitir operacoes solicitadas por voce na sua propria sessao (ex.: listar cadernos, sincronizar e exportar).
- Armazenamento: preferencialmente em armazenamento de sessao do Chrome (`chrome.storage.session`), com fallback tecnico para `chrome.storage.local` quando necessario.

### 2.3 Conteudo capturado por voce

- Textos, titulos, links de origem, identificadores de notebook/fonte e demais dados que voce escolhe capturar, sincronizar ou exportar.
- Finalidade: executar as funcionalidades contratadas (captura, organizacao, exportacao e sincronizacao).

### 2.4 Integracao Google (Docs/Drive)

- Token OAuth obtido via `chrome.identity` quando voce autoriza.
- Finalidade: criar/exportar documentos na sua conta Google.
- Uso: token utilizado para operacao autorizada pelo usuario.

### 2.5 Integracao Notion

- Token OAuth do Notion necessario para exportar conteudo ao seu workspace.
- Armazenamento atual da extensao: `chrome.storage.local`.
- Finalidade: publicar paginas no Notion quando voce solicitar.

### 2.6 Pagamentos e assinatura

- Dados de assinatura e identificadores de cobranca.
- Cartao nao e processado pela MindDock; o processamento financeiro ocorre no provedor de pagamento (ex.: Stripe).

### 2.7 Diagnostico tecnico minimo

- Eventos tecnicos de erro (ex.: tipo de erro, status HTTP, endpoint sanitizado e plataforma sanitizada), sem conteudo integral de chat no payload de telemetria padrao.
- Finalidade: estabilidade, seguranca e melhoria do servico.

---

## 3. Como usamos os dados

Usamos dados para:

- autenticar usuarios e manter sessao;
- executar funcionalidades da extensao e integracoes;
- controlar limites de plano e faturamento;
- prevenir abuso, fraude e uso indevido;
- diagnosticar falhas e melhorar o produto;
- cumprir obrigacoes legais e regulatorias.

---

## 4. Compartilhamento com terceiros

Compartilhamos dados apenas quando necessario para operar os recursos solicitados:

- **Supabase:** autenticacao, banco de dados e funcoes backend;
- **Google APIs:** exportacao/sincronizacao com Google Docs e Drive;
- **Notion API:** exportacao para o workspace Notion;
- **Stripe (ou provedor equivalente):** cobranca e assinaturas;
- **Provedor de IA via backend MindDock (ex.: Anthropic/Claude):** apenas para recursos de IA acionados por voce.

Nao vendemos dados pessoais para anunciantes.

---

## 5. Bases legais (LGPD)

Tratamos dados com base em, conforme o caso:

- execucao de contrato e procedimentos preliminares;
- exercicio regular de direitos e cumprimento de obrigacoes legais;
- legitimo interesse (seguranca, prevencao de fraude e melhoria do servico);
- consentimento, quando exigido para certas integracoes/operacoes.

---

## 6. Retencao e exclusao

Em geral:

- dados locais da extensao permanecem no navegador ate limpeza, revogacao ou desinstalacao;
- dados de conta e assinatura permanecem enquanto a conta estiver ativa e pelo periodo necessario para obrigacoes legais;
- dados operacionais e logs tecnicos sao mantidos pelo tempo necessario a suporte, seguranca e auditoria.

Voce pode solicitar exclusao de dados de conta pelo contato oficial.

---

## 7. Seguranca

Adotamos medidas tecnicas e organizacionais razoaveis, incluindo:

- comunicacao via HTTPS;
- controles de autenticacao no backend;
- minimizacao de coleta para diagnostico tecnico;
- segregacao entre dados de conta e operacoes de integracao.

Nenhum sistema e 100% imune, mas trabalhamos para reduzir riscos continuamente.

---

## 8. Transferencia internacional

Como usamos provedores globais (Google, Notion, Stripe, Supabase e provedor de IA), pode haver transferencia internacional de dados, sempre com medidas contratuais e tecnicas adequadas.

---

## 9. Seus direitos (LGPD)

Voce pode solicitar:

- confirmacao da existencia de tratamento;
- acesso aos dados;
- correcao de dados incompletos, inexatos ou desatualizados;
- anonimizacao, bloqueio ou eliminacao quando cabivel;
- portabilidade, quando aplicavel;
- informacao sobre compartilhamentos;
- revogacao de consentimento, quando a base legal for consentimento.

Para exercer direitos, contate: hello@minddocklm.digital

---

## 10. Google API Services User Data Policy

Quando a MindDock acessa dados por meio de APIs do Google, esse uso segue a politica de dados de usuario de servicos de API do Google, incluindo requisitos de uso limitado, conforme aplicavel.

---

## 11. Menores de idade

A MindDock nao e direcionada a menores de 18 anos. Se identificarmos tratamento indevido de dados de menores sem base legal, adotaremos medidas de exclusao e bloqueio cabiveis.

---

## 12. Alteracoes desta politica

Podemos atualizar esta Politica. A versao vigente sempre estara publicada com data de revisao no topo.

Quando houver mudancas relevantes, poderemos notificar por e-mail, site ou extensao.

---

## 13. Contato

- **E-mail:** hello@minddocklm.digital  
- **Site:** https://minddocklm.digital
