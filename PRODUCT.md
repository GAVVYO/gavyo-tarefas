# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A equipe interna da GAVYO (hoje: Felipe, Bola, Passa Marcha e o dono da conta). Gente acostumada com sistemas. Abrem o quadro principalmente **no computador**, durante o dia de trabalho; o celular é para olhar rápido. Clientes não usam.

Os assistentes de código (**Codex e Claude**) também são usuários: pelo MCP, com token pessoal de alguém da equipe, consultam, criam, atribuem, movem e comentam cartões. Pessoas e assistentes usam o quadro **por igual**.

## Product Purpose

Quadro Kanban privado da GAVYO: cada projeto da empresa (ex.: GAVYO Auto) tem suas etapas A fazer, Em andamento e Concluído. Serve para dividir o trabalho, ver quem está fazendo o quê e o que está travado. Sucesso é a equipe abrir o quadro e entender em segundos o estado de cada pessoa e de cada projeto, e um assistente conseguir pegar uma tarefa sem ninguém repassar contexto.

## Positioning

Não é um Trello genérico: é o mural **da equipe GAVYO**, onde as pessoas (com seus avatares) e os assistentes de IA trabalham no mesmo quadro, com o histórico dizendo quem fez o quê e por qual canal (Web, Codex, Claude).

## Operating Context

- Entrada por perfil + PIN de 4 números (sem e-mail). Administrador cria projetos e perfis.
- Visões: Quadro (por projeto), Minhas tarefas (do perfil conectado), Arquivo.
- Cartão: título, descrição, responsável, prazo, prioridade (alta/normal/baixa), bloqueio com motivo, checklist, conversa, histórico com autor e canal.
- Tokens MCP pessoais de 30 dias, revogáveis; "Atualizar quadro" traz mudanças feitas pelo MCP ou por outras pessoas.
- Fuso de referência: America/Fortaleza.

## Capabilities and Constraints

- Node.js 22 + Express 5, front-end em JavaScript puro (sem framework, sem build), CSS em `public/styles.css`. SQLite local, MySQL em produção (`tarefas.gavyo.me`).
- CSP rígida (sem scripts/estilos inline externos); ícones Lucide servidos localmente; fonte Manrope local.
- Teste de integração com `npm test` (node --test).

## Brand Commitments

- Nome: **GAVYO Tarefas**. Faz parte da família GAVYO (mesma casa do GAVYO Auto).
- **Águia dourada** (`public/aguia-dourada.svg`) é a marca e fica.
- **Avatares 3D da equipe** (`assets/avatars/*.glb` e `.png`: felipe, bola, passa-marcha) são da identidade e devem aparecer **mais**.
- **Paleta dourada**: é a variação da GAVYO para este produto (decisão do usuário, 20/11/2026).
- Linguagem em português, direta.

## Evidence on Hand

Projetos e cartões reais vivem no banco de produção; nada de números, depoimentos ou métricas inventados.

## Product Principles

1. A equipe vem primeiro: quem está fazendo o quê se vê antes de qualquer outra coisa.
2. Pessoas e assistentes são cidadãos iguais do quadro; o canal de cada ação fica visível.
3. O que está travado ou atrasado chama atenção; o resto fica calmo.
4. Feito para o computador, sem quebrar no celular.
