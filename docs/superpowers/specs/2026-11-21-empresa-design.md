# Tela Empresa: Notas, Agenda e Caixa

Aprovado pelo Felipe em 2026-11-21. Substitui a aba Financeiro da Central de projetos.

## Por quê
O financeiro como aba de projeto ficou apertado e cru. A equipe quer um lugar da empresa para ideias, reclamações, datas e dinheiro, bonito e vivo.

## Partes (um PR cada, nesta ordem)
1. **Notas:** uma página-mural onde cada nota é uma folha de caderno (margem vermelha, linhas, leve inclinação), com o rosto de quem criou, título e texto.
   - Arrastar a nota para qualquer ponto. A posição vale para todos.
   - Soltar a nota na borda direita da tela, ou usar "Levar comigo", deixa a nota flutuando na lateral enquanto a pessoa usa o resto do site. Isso vale só para quem fez.
2. **Agenda:** calendário do mês. Os dias com itens ganham post-its com sombra e dobra. Ao arrastar, o post-it balança; ao soltar em outro dia, um gavião vem e prega o post-it. Criar um item é um formulário em etapas.
3. **Caixa:** gavião com balde de dinheiro, que põe dinheiro ao lançar uma entrada e tira ao lançar uma saída. Cada lançamento guarda valor, tipo, quem lançou, de quem é, para que é, data e categoria. Os gastos do financeiro atual migram para cá.

## Decisões
- Tela própria no menu ("Empresa"), da empresa inteira; cada item pode ter um projeto opcional.
- Servidor: tabela `company_items (id, kind, version, data)`, com kinds `note`, `event` e `cash`, e REST `/api/company/:kind`. A edição exige `version`, como nos cartões.
- Gavião em SVG, no estilo da águia dourada. Animações respeitam `prefers-reduced-motion`.
- Visual: tokens das paletas e tipografia atual, nada cru. Cada tela é revisada como usuária, com capturas no PC e no celular, antes do PR.

## Fora do escopo
Rateio e acertos entre pessoas (o financeiro atual) ficam onde estão até a parte 3 decidir a migração.
