# Passos com detalhes: o cartão vira uma lista de demandas

Aprovado pelo Felipe em 2026-11-21.

## Por quê
Hoje cada problema vira um cartão, e o detalhe fica nos comentários, o que polui o quadro.
A partir de agora, cada rodada vira **um cartão com vários passos**, e cada passo carrega a demanda inteira.
A conversa fica em segundo plano.

## Objetivos
- Cada passo tem título, detalhes (reprodução, causa, correção) e link do PR.
- Pessoas e IAs mexem em um passo sem reenviar nem apagar os outros.
- No cartão aberto, os passos são a parte principal e a conversa fica recolhida.

## Fora do escopo
Responsável, estado, conversa ou travado por passo (opções B e C, recusadas).

## Abordagens consideradas
- **Ampliar o passo existente (escolhida):** reaproveita a lista, a trilha da águia e o contador.
- Montar os detalhes a partir da descrição em Markdown: frágil e ilegível pelo MCP.
- Criar um tipo novo de "demanda": duplica os passos e quase recria o quadro dentro do cartão.

## Servidor (Codex)
- Passo = `{ id, title (240), done, details (até 4000, padrão ''), pr (URL http(s) opcional, padrão '') }`.
- Passos antigos sem `id` recebem um id estável na primeira gravação e são lidos com `details: ''` e `pr: ''`.
- MCP: `adicionar_passo(id, title, details?, pr?)`, `atualizar_passo(id, passoId, title?, details?, pr?, done?)` e `remover_passo(id, passoId)`.
  Os três seguem a mesma regra de versão e concorrência de `atualizar_tarefa`. Cada um entra no histórico do cartão.
- `atualizar_tarefa.checklist` continua aceitando a lista completa. Um item sem id ganha um novo, e um item com id preserva os campos que não foram enviados.
- `ver_tarefa` devolve os passos completos. `listar_tarefas` continua sem os passos.
- Texto de "Entregar para o assistente" (`public/app.js:356`): inclui os detalhes e o PR de cada passo.

## Tela (Claude)
- Na ficha do cartão, os passos vêm logo depois da descrição, antes das prints.
- Clicar no texto do passo abre os detalhes embaixo dele: um campo de detalhes e um campo de PR, que salvam ao sair do campo.
  A caixa de marcar continua marcando. Um passo com detalhes ou PR mostra um ícone pequeno.
- A conversa vira uma aba recolhida, com a contagem ("Conversa · 3"). A caixa de mensagem só aparece com a aba aberta.
  O histórico continua na aba ao lado.
- O cartão no quadro não muda.
- Acessibilidade: o botão que abre os detalhes usa `aria-expanded` e `aria-controls`, e o foco vai para os detalhes ao abrir.

## Ordem
1. PR do servidor (Codex), com testes.
2. PR da tela (Claude), depois do 1.
3. Converter os cartões de revisão para o formato novo (os detalhes migram da descrição para os passos).

## Decidido pelo Claude, pode corrigir
- Os limites de 4000 letras nos detalhes e de 60 passos (o limite atual) se mantêm.
- A conversa começa recolhida em todo cartão.
