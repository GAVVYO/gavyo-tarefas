import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { AppError, newCard, status } from './store.js';

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
      ref: z.object({ kind: z.enum(['commit', 'contexto', 'cartao']), id: z.string().max(120), label: z.string().max(200) }).optional() },
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
  add('atualizar_tarefa', 'Atribui, move ou comenta uma tarefa existente. Etapas: todo (A fazer), doing (Em andamento), done (Concluído).',
    { id: z.uuid(), assigneeId: z.uuid().nullable().optional(), status: status.optional(),
      blocked: z.string().max(500).optional(), comment: z.string().min(1).max(2000).optional() },
    false, ({ id, ...patch }) => store.updateCard(id, patch, actor));

  const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
  res.on('close', () => { void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
