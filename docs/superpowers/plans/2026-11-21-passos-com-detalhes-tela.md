# Passos com detalhes: tela — plano de implementação

> **Para agentes:** use superpowers:executing-plans. Os passos usam caixas (`- [ ]`).

**Objetivo:** na ficha do cartão, cada passo abre os detalhes e o PR embaixo dele, e a conversa vira uma aba recolhida.

**Arquitetura:** só `public/app.js` e `public/styles.css`, em cima da branch `codex/passos-com-detalhes` (PR #18), que já entrega os passos `{ id, title, done, details, pr }` e as rotas por passo.

**Stack:** JavaScript puro, CSS sem style inline (CSP rígida).

**Spec:** `docs/superpowers/specs/2026-11-21-passos-com-detalhes-design.md`

## Restrições globais
- Detalhes com no máximo 4000 letras; PR vazio ou link `http(s)`; no máximo 60 passos.
- Nada de `style=` inline (CSP). Textos em português simples.
- Rotas: `POST /api/cards/:id/steps`, `PATCH|DELETE /api/cards/:id/steps/:passoId`, com `version` no corpo; devolvem o cartão.
- O cartão no quadro não muda.

## Foco de revisão
1. Duas pessoas editam passos diferentes ao mesmo tempo: nenhuma perde o texto (o 409 relê e reaplica, como faz o `saveCard`).
2. Sair do campo sem mudar nada não grava (não suja o histórico).
3. PR inválido (sem http): o servidor recusa e a mensagem de erro aparece, sem perder o que foi digitado.
4. Um passo antigo (sem id salvo) abre e salva detalhes normalmente.
5. Uma atualização do quadro chega enquanto a pessoa digita nos detalhes: o texto não some (o `syncOpenCard` já trata `textarea` focada).

Verificação: script Playwright no scratchpad contra um servidor local com SQLite (o projeto não tem testes de navegador, e `test/` é do Codex). Cada item acima vira uma checagem do script.

---

### Tarefa 1: detalhes que abrem embaixo do passo
**Arquivos:** `public/app.js` (render da `.ficha-steps`, por volta da linha 1088; handlers de clique e de saída do campo); `public/styles.css` (bloco dos passos).

**Interfaces:**
- Produz `saveStep(cardId, stepId, patch, done?)`: faz `PATCH /cards/:id/steps/:stepId` com `version`; no 409, chama `refresh()` e reaplica se o passo ainda existe; depois redesenha a ficha com `rerenderCard`.
- Cada linha ganha o botão `data-action="step-details"` com `aria-expanded` e `aria-controls="step-<id>"`, e o painel `#step-<id>` com `textarea[data-step-field=details]` e `input[type=url][data-step-field=pr]`, os dois com `data-card` e `data-step`.
- O passo com detalhes ou PR mostra o ícone `file-text` (com o texto sr-only "tem detalhes").
- Os painéis abertos sobrevivem ao `rerenderCard`: guarde o conjunto de ids abertos num `Set` no módulo.

- [ ] Script: abrir um cartão, abrir o passo 1, escrever detalhes e PR e sair do campo. Esperado: depois do recarregamento os valores voltam, o histórico ganha 1 entrada e sair de novo sem mudar não cria entrada. Rodar e ver falhar.
- [ ] Implementar o render, o botão, o painel, o `saveStep` (só envia o que mudou) e o CSS.
- [ ] Rodar o script e ver passar. Incluir os itens 1 a 5 do foco de revisão.
- [ ] Commit.

### Tarefa 2: conversa como aba recolhida
**Arquivos:** `public/app.js` (`showCard`, por volta das linhas 1100 a 1107; `setTaskSection`, linha 1120); `public/styles.css`.

**Interfaces:**
- `setTaskSection(section)` passa a aceitar `null`, que recolhe tudo: os painéis e a `.composer` ficam escondidos.
- A ficha abre com `section = null`. Os botões viram "Conversa · N" (N = `card.comments.length`, omitido quando é 0) e "Histórico", com `aria-expanded`. Clicar na aba aberta recolhe de novo.
- O `rerenderCard` preserva o estado (já guarda `section`; `null` precisa continuar `null`).

- [ ] Script: abrir um cartão. Esperado: a thread e a composer estão escondidas. Clicar em "Conversa · 1": aparecem. Clicar de novo: somem. Rodar e ver falhar.
- [ ] Implementar.
- [ ] Rodar e ver passar; no celular (iPhone 13), conferir a captura.
- [ ] Commit.

### Tarefa 3: converter os cartões de revisão
Pelo MCP, depois do merge do #18 em produção: no GT-12 e no GT-13, mover o texto de cada bloco "■ …" da descrição para os `details` do passo correspondente, pôr o link do PR em `pr` e deixar na descrição só o resumo.

- [ ] Rodar o script de conversão; conferir com `ver_tarefa`.
