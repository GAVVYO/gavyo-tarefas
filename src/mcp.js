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
