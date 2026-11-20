# GAVYO Tarefas

Quadro privado da equipe GAVYO. Cada projeto tem um Kanban. **Minhas tarefas** reúne os cartões atribuídos à pessoa conectada. O navegador e o MCP usam as mesmas contas, cartões e histórico.

## Rodar localmente

Use Node.js 22 e npm.

```sh
npm ci
cp .env.example .env
```

Preencha o nome do administrador em `.env`. O PIN inicial é `1234` e pode ser definido já no setup com `ADMIN_PIN`. Em `INITIAL_PROJECTS`, coloque o nome de cada projeto separado por vírgula ou crie o segundo projeto no painel depois.

```sh
npm run setup
npm start
```

Abra [localhost:3000](http://127.0.0.1:3000). O banco local fica em `.data/`. Remova `ADMIN_PIN` do arquivo após o setup, caso tenha definido um. O administrador pode criar projetos e perfis da equipe pelo menu **Projetos e equipe**. Na entrada, cada pessoa escolhe seu perfil e digita o PIN. Na sidebar, **Alterar PIN** troca o PIN do perfil conectado. Os membros do quadro compartilham visibilidade e edição dos projetos. Criar projetos e contas exige perfil de administrador.

## Conectar Codex e Claude Code

No menu **Conectar ao Codex ou Claude**, gere um token pessoal para a ferramenta escolhida. O token vale 30 dias, pode ser revogado no mesmo menu e fica associado à conta que o criou. O histórico mostra a pessoa e a ferramenta selecionada ao gerar o token.

No Codex, configure o servidor e forneça o token na variável de ambiente `GAVYO_MCP_TOKEN` antes de iniciar a sessão:

```toml
[mcp_servers.gavyo-tarefas]
url = "https://tarefas.gavyo.me/mcp"
bearer_token_env_var = "GAVYO_MCP_TOKEN"
```

No Claude Code, inicie a sessão com `GAVYO_MCP_TOKEN` disponível no ambiente. A configuração de projeto em `.mcp.json` pode referenciar a variável assim:

```json
{
  "mcpServers": {
    "gavyo-tarefas": {
      "type": "http",
      "url": "https://tarefas.gavyo.me/mcp",
      "headers": { "Authorization": "Bearer ${GAVYO_MCP_TOKEN}" }
    }
  }
}
```

Para testes locais, troque o URL por `http://127.0.0.1:3000/mcp`. Use o botão **Atualizar quadro** para carregar mudanças feitas pelo MCP ou por outra pessoa. Guarde tokens fora do Git.

## Hospedagem

O deploy previsto usa um site Node.js 22 e um banco MySQL dedicados. Configure `NODE_ENV=production`, `PUBLIC_ORIGIN=https://tarefas.gavyo.me` e `DATABASE_URL` nas variáveis da hospedagem. O servidor usa a porta recebida em `PORT`. Os prints dos cartões ficam em `UPLOAD_DIR` (padrão `.data/uploads`); na hospedagem, aponte para uma pasta fora da pasta do app, para uma publicação nova não apagar as imagens. A URL do MySQL deve ter usuário e senha codificados para URL quando contiverem caracteres especiais.

Rode `npm run setup` com a conexão de produção e as variáveis do primeiro administrador, retire `ADMIN_PIN` do ambiente, se usado e inicie com `npm start`. Confira HTTPS, login e MCP no domínio antes de compartilhar o quadro.

## Verificação

```sh
npm test
```

O teste de integração usa SQLite em memória e cobre autenticação, permissões, criação via MCP, atribuição, mudança de etapa, comentário, checklist, autoria no histórico e arquivo.
