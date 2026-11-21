# GT-15 — Chat global da equipe

Uma conversa autenticada, independente do projeto selecionado e dos rascunhos dos cartões.

## Interface

- Botão flutuante “Chat da equipe”, também disponível sobre diálogos modais; atalho `Ctrl+Shift+Z`. A posição e o atalho ficam propostos para revisão de Felipe no PR.
- Diálogo nativo na camada superior: painel lateral no desktop e tela cheia até 640 px. `Esc` fecha primeiro o chat; o DOM inferior permanece e o foco anterior é restaurado.
- Texto de até 4000 caracteres, envio explícito pelo botão, estado de envio e erro com nova tentativa. Enter envia a mensagem; Shift+Enter mantém a quebra de linha. Composição por IME não dispara envio.
- O rascunho do chat fica só na memória da sessão. Sair da conta apaga os dados locais do chat.
- Histórico recente ao abrir e mensagens antigas pelo botão ou rolagem ao topo. Atualização em tempo real por SSE (EventSource), com envio imediato no processo local, retomada por Last-Event-ID e reconexão automática. O navegador não faz polling de mensagens; fechar encerra a conexão. No servidor, uma reconciliação a cada segundo cobre gravações em outros workers e verifica revogação da sessão; heartbeat mantém a conexão ativa. Há tempo máximo nas requisições de histórico e envio.
- A área de composição acompanha `visualViewport` em telas pequenas. Movimento reduzido é respeitado.

## API e persistência

- `GET /api/team/messages?limit=50`: últimas mensagens em ordem cronológica.
- `before=<sequence>`: páginas antigas; `after=<sequence>`: mensagens novas, ambas exclusivas. Limite de 1 a 100; os dois cursores não podem ser combinados.
- Resposta: `{ messages, hasMore, nextBefore, nextAfter }`. Cada mensagem contém `{ id, sequence, text, author: { id, name }, at }`.
- `GET /api/team/messages/stream?after=<sequence>` abre SSE autenticado: eventos `messages` carregam mensagens em ordem; o campo `id` é a sequência. Na reconexão, `Last-Event-ID` prevalece sobre o cursor da URL. Revogação da sessão encerra o stream.
- `POST /api/team/messages` recebe apenas `{ text, clientId }`. Autor e data são definidos no servidor a partir da sessão. `clientId` é um UUID de reenvio: a mesma pessoa e o mesmo texto retornam a mensagem existente; colisão com outro autor/texto retorna 409.
- Uma sequência autoincremental evita saltos quando mensagens chegam no mesmo milissegundo. A tabela `team_messages` é criada no bootstrap, de forma aditiva, em SQLite ou MySQL. Sem alteração dos dados existentes; não há exclusão de histórico neste PR.
- Rotas usam a autenticação, a proteção de origem e `Cache-Control: no-store` já existentes. Texto renderizado com `textContent`.

## Verificação

- Teste de integração HTTP/SQLite: duas sessões, bloqueio de leitura/envio anônimo, autoria, validação, origem, reenvio idempotente, mensagens concorrentes, paginação anterior/posterior e encerramento de sessão. Teste SSE cobre entrega, retomada de cursor, outro worker e revogação com conexão aberta.
- Chrome local com banco e pessoas de teste: recebimento entre sessões em hosts distintos sem recarregar, 55 mensagens de histórico, cartão com passo não enviado, diálogo com texto não enviado e visualizador de print preservados após abrir/fechar o chat.
- Tab permanece no chat sobre o visualizador; Esc mantém a tela inferior. Em 390 × 844, composição visível e sem overflow horizontal. Queda de rede simulada pelo DevTools mantém o texto e a nova tentativa envia após reconexão. Enter/Shift+Enter e Ctrl+Shift+Z verificados no Chrome; mensagens enviadas por outra sessão durante uma desconexão chegaram uma única vez na retomada SSE.
- Limites da prova: MySQL e teclado virtual de um aparelho físico não foram executados neste ambiente. A verificação móvel usa viewport de navegador desktop.

Revisão em branch separada; este documento não autoriza merge ou deploy.
