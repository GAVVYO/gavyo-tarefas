# GAVYO Tarefas

Quadro privado da equipe GAVYO. Cada projeto tem um Kanban. **Minhas tarefas** reúne os cartões atribuídos à pessoa conectada. O navegador e o MCP usam as mesmas contas, cartões e histórico.

## Rodar localmente

Use Node.js 22 e npm.

```sh
npm ci
cp .env.example .env
```

Preencha nome, e-mail e senha do admin em `.env`. A senha precisa ter pelo menos 12 caracteres. Em `INITIAL_PROJECTS`, coloque o nome de cada projeto separado por vírgula ou crie o segundo projeto no painel depois.

```sh
npm run setup
npm start
```

Abra [localhost:3000](http://127.0.0.1:3000). O banco local fica em `.data/`. Retire `ADMIN_PASSWORD` do arquivo após o setup. O administrador pode criar projetos e contas da equipe pelo menu **Projetos e equipe**. Os membros do quadro compartilham visibilidade e edição dos projetos. Criar projetos e contas exige perfil de administrador.

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

O deploy previsto usa um site Node.js 22 e um banco MySQL dedicados. Configure `NODE_ENV=production`, `PUBLIC_ORIGIN=https://tarefas.gavyo.me` e `DATABASE_URL` nas variáveis da hospedagem. O servidor usa a porta recebida em `PORT`. A URL do MySQL deve ter usuário e senha codificados para URL quando contiverem caracteres especiais.

Rode `npm run setup` com a conexão de produção e as variáveis do primeiro administrador, retire `ADMIN_PASSWORD` do ambiente e inicie com `npm start`. Confira HTTPS, login e MCP no domínio antes de compartilhar o quadro.

## Verificação

```sh
npm test
```

O teste de integração usa SQLite em memória e cobre autenticação, permissões, criação via MCP, atribuição, mudança de etapa, comentário, checklist, autoria no histórico e arquivo.
