import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { AppError, newCard, newStep, patchCard, projectInput, stepPatch } from './store.js';
import { recentCommits } from './github.js';

export async function serveMcp(req, res, store, actor) {
  const server = new McpServer({ name: 'gavyo-tarefas', version: '1.0.0' });
  function add(name, description, inputSchema, readOnlyHint, execute) {
    server.registerTool(name, {
      description, inputSchema, annotations: { readOnlyHint, destructiveHint: false, openWorldHint: false }
    }, async (input) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(await execute(input)) }] };
      } catch (error) {
        if (!(error instanceof AppError) && !(error instanceof z.ZodError)) console.error(error);
        return { isError: true, content: [{ type: 'text', text:
          error instanceof AppError || error instanceof z.ZodError ? error.message : 'Não foi possível completar a operação.' }] };
      }
    });
  }

  add('listar_projetos', 'Lista os projetos e seus IDs.', {}, true, store.projects);
  add('ver_contexto_projeto', 'Lê o contexto do projeto (o que é, objetivo, regras, stack, decisões, links, responsável, produção, teste e repositório). Leia antes de começar qualquer tarefa do projeto. Guarde o campo version: ele é a versaoLida que atualizar_contexto_projeto exige.',
    { projectId: z.uuid() }, true, ({ projectId }) => store.markContextRead(projectId, actor));
  add('atualizar_contexto_projeto', 'Atualiza o contexto do projeto. Obrigatório mandar versaoLida = o version que você leu em ver_contexto_projeto; se alguém mudou depois, a gravação é recusada e você deve ler de novo. Mande só o que mudou; registre decisões importantes em decisoes. Fica registrado quem escreveu, por qual canal, quando e qual versão leu.',
    { projectId: z.uuid(), versaoLida: z.number().int().min(0), resumo: z.string().max(12000).optional(), objetivo: z.string().max(12000).optional(),
      regras: z.string().max(12000).optional(), stack: z.string().max(12000).optional(), decisoes: z.string().max(12000).optional(),
      links: z.array(z.object({ title: z.string(), url: z.string() })).max(30).optional(),
      producao: z.string().max(500).optional(), teste: z.string().max(500).optional(), repositorio: z.string().max(200).optional(), branch: z.string().max(120).optional(),
      responsavelId: z.uuid().nullable().optional() },
    false, ({ projectId, ...patch }) => store.setProjectContext(projectId, patch, actor));
  add('historico_contexto_projeto', 'Lista as versões do contexto do projeto: quem escreveu, por qual canal, quando, qual versão leu antes e o que mudou (inclui tentativas recusadas).',
    { projectId: z.uuid() }, true, async ({ projectId }) => (await store.contextHistory(projectId)).map(({ snapshot, ...entry }) => entry));
  add('ler_mensagens_projeto', 'Lê a conversa do projeto na Central de projetos (equipe e assistentes).',
    { projectId: z.uuid() }, true, ({ projectId }) => store.projectMessages(projectId));
  add('enviar_mensagem_projeto', 'Escreve na conversa do projeto. Use para avisar o que fez, pedir decisão ou responder alguém. Pode citar um item da linha do tempo em ref.',
    { projectId: z.uuid(), text: z.string().min(1).max(4000),
      ref: z.object({ kind: z.enum(['commit', 'pr', 'contexto', 'cartao']), id: z.string().max(120), label: z.string().max(200) }).optional() },
    false, ({ projectId, ...input }) => store.addProjectMessage(projectId, input, actor));
  add('listar_membros', 'Lista responsáveis disponíveis e seus IDs.', {}, true, store.members);
  add('listar_tarefas', 'Lista tarefas ativas. Use minhas=true para ver as atribuídas à pessoa conectada.',
    { projectId: z.uuid().optional(), minhas: z.boolean().optional(), blocked: z.boolean().optional(), archived: z.boolean().optional() },
    true, async ({ minhas, ...filters }) => {
      const cards = await store.listCards({ ...filters, assigneeId: minhas ? actor.id : undefined });
      return cards.map(({ history, comments, checklist, ...card }) => card);
    });
  add('criar_tarefa', 'Cria tarefa numa coluna A fazer. Use IDs de projeto e responsável obtidos pelas ferramentas de listagem.',
    newCard.shape, false, (input) => store.createCard(input, actor));
  const cardVersion = z.int().positive().optional();
  add('atualizar_tarefa', 'Muda qualquer coisa de uma tarefa: título, descrição, responsável, prazo (AAAA-MM-DD), prioridade (alta/normal/baixa), etapa (todo, doing, done), travado (motivo; vazio destrava), passos (lista completa), arquivar (só concluídas) e comentário. Mande só o que muda. Passe version para recusar a mudança se o cartão já mudou.',
    { id: z.uuid(), version: cardVersion, ...patchCard.shape }, false, ({ id, version, ...patch }) => store.updateCard(id, patch, actor, version));
  add('adicionar_passo', 'Adiciona um passo à tarefa. Devolve o cartão atualizado, com o ID do novo passo.',
    { id: z.uuid(), version: cardVersion, ...newStep.shape }, false, ({ id, version, ...step }) => store.addStep(id, step, actor, version));
  add('atualizar_passo', 'Edita um passo pelo ID. Mande só os campos que mudam. Passe version para recusar a edição se o cartão já mudou.',
    { id: z.uuid(), passoId: z.uuid(), version: cardVersion, ...stepPatch.shape }, false,
    ({ id, passoId, version, ...patch }) => store.updateStep(id, passoId, patch, actor, version));
  add('remover_passo', 'Remove um passo pelo ID. Passe version para recusar a remoção se o cartão já mudou.',
    { id: z.uuid(), passoId: z.uuid(), version: cardVersion }, false,
    ({ id, passoId, version }) => store.removeStep(id, passoId, actor, version));
  add('ver_tarefa', 'Tudo de uma tarefa: descrição, passos, conversa, prints e histórico com autor e canal.',
    { id: z.uuid() }, true, async ({ id }) => {
      const card = (await store.listCards({})).concat(await store.listCards({ archived: true })).find((item) => item.id === id);
      if (!card) throw new AppError(404, 'Tarefa não encontrada.');
      return card;
    });
  add('atividade_projeto', 'Commits e PRs do GitHub do projeto (do repositório informado no contexto), do mais novo ao mais velho.',
    { projectId: z.uuid() }, true, async ({ projectId }) => {
      const ctx = await store.projectContext(projectId);
      const [github, pushed] = await Promise.all([recentCommits(ctx.repositorio, ctx.branch), store.githubEvents(ctx.repositorio, ctx.branch)]);
      const seen = new Set(pushed.map((item) => item.id));
      const items = [...pushed, ...github.commits.map((item) => ({ kind: 'commit', id: `commit:${item.sha}`, ...item })).filter((item) => !seen.has(item.id))];
      return { repositorio: ctx.repositorio, aviso: github.note || undefined, itens: items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60) };
    });
  add('voltar_versao_contexto', 'Volta o contexto do projeto para uma versão anterior (vira uma versão nova). Exige versaoLida, como atualizar_contexto_projeto.',
    { projectId: z.uuid(), version: z.number().int().min(1), versaoLida: z.number().int().min(0) },
    false, ({ projectId, version, versaoLida }) => store.restoreContext(projectId, version, { versaoLida }, actor));
  add('criar_projeto', 'Cria um projeto no quadro (só administrador).', projectInput.shape, false, (input) => {
    if (actor.role !== 'admin') throw new AppError(403, 'Apenas administradores podem criar projetos.');
    return store.createProject(input);
  });
  add('criar_membro', 'Cria o perfil de alguém da equipe (só administrador). PIN inicial 1234 se não informado; papel member ou admin.',
    { name: z.string().min(1).max(100), role: z.enum(['admin', 'member']).optional(), pin: z.string().regex(/^[0-9]{4}$/).optional() }, false, (input) => {
      if (actor.role !== 'admin') throw new AppError(403, 'Apenas administradores podem criar perfis.');
      return store.createMember(input);
    });

  const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
  res.on('close', () => { void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
