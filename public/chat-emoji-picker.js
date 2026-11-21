// Catálogo local: nenhuma busca ou conteúdo da conversa sai do site.
const groups = [
  ['Rostos','😊','😀 sorriso|😃 feliz|😄 alegria|😁 sorrindo|😆 risada|😅 suor alívio|😂 rindo lágrimas|🤣 gargalhada|😊 contente|🙂 sorriso leve|🙃 invertido ironia|😉 piscando|😍 apaixonado|🥰 carinho|😘 beijo|😋 gostoso|😛 língua|🤪 brincadeira|😎 óculos legal|🤓 estudioso|🥳 festa|🤩 estrelas|🥹 emocionado|🥺 por favor|😭 chorando|😢 triste|😔 desanimado|😴 sono|🥱 bocejo|🤔 pensando|🧐 analisando|🤨 dúvida|😐 neutro|😶 sem palavras|🤐 segredo|😬 nervoso|🙄 revirando olhos|😮 surpresa|😲 espanto|😱 medo|😳 vergonha|😤 irritado|😡 raiva|🤬 bravo|🤯 cabeça explodindo|🫠 derretendo|🤗 abraço|🤭 risinho|🫡 respeito|🤫 silêncio|🤥 mentira|🤢 enjoo|🤮 vomitando|🤒 doente|🤕 machucado|😷 máscara|👻 fantasma|💀 caveira|🤖 robô|💩 cocô|😺 gato feliz|😻 gato apaixonado|🙈 não vi|🙉 não ouvi|🙊 não falei'],
  ['Gestos','👋','👍 positivo gostei ok|👎 negativo não gostei|👏 palmas parabéns|🙌 comemorar|🙏 obrigado por favor oração|🤝 acordo parceria|👋 olá tchau|👌 perfeito|✌️ paz vitória|🤞 sorte|🤟 amor|🤘 rock|🤙 chamar|🫶 coração mãos|💪 força|👊 soco|✊ união|✋ parar mão|🤚 mão levantada|🖐️ cinco|👆 acima|👇 abaixo|👈 esquerda|👉 direita|🫵 você|☝️ atenção|✍️ escrever|🤳 selfie|💅 unhas|🧠 cérebro ideia|👀 olhos olhando|👁️ olho|👂 ouvido|💃 dançar|🕺 dança|🙋 pergunta|🤷 não sei|🤦 facepalm|🧑‍💻 programador tecnologia|👩‍💻 programadora|👨‍💻 desenvolvedor'],
  ['Corações','❤️','❤️ amor coração vermelho|🧡 laranja|💛 amarelo|💚 verde|💙 azul|💜 roxo|🖤 preto|🤍 branco|🤎 marrom|🩷 rosa|🩵 azul claro|🩶 cinza|💔 partido tristeza|❤️‍🔥 apaixonado fogo|❤️‍🩹 recuperação|💕 dois corações|💖 brilhante|💗 crescendo|💓 batendo|💞 girando|💘 cupido|💝 presente|💯 cem perfeito|💢 raiva|💥 explosão|💫 estrelas|💦 suor|💨 rápido|💬 conversa|🗨️ chat|💭 pensando|🫂 abraço'],
  ['Natureza','🌿','🐶 cachorro|🐱 gato|🐭 rato|🐹 hamster|🐰 coelho|🦊 raposa|🐻 urso|🐼 panda|🐨 coala|🐯 tigre|🦁 leão|🐮 vaca|🐷 porco|🐸 sapo|🐵 macaco|🐔 galinha|🐧 pinguim|🐦 pássaro|🦅 gavião águia gavyo|🦉 coruja|🦋 borboleta|🐝 abelha|🐢 tartaruga|🐬 golfinho|🐳 baleia|🦈 tubarão|🐙 polvo|🌻 girassol|🌹 rosa flor|🌷 tulipa|🌸 flores|🌿 planta|🍀 sorte|🌵 cacto|🌳 árvore|🌎 mundo|🌞 sol|🌙 lua|⭐ estrela|🌈 arco íris|☁️ nuvem|🌧️ chuva|⚡ raio|❄️ neve|🔥 fogo|💧 água'],
  ['Comida','🍕','🍎 maçã|🍊 laranja fruta|🍋 limão|🍌 banana|🍉 melancia|🍇 uva|🍓 morango|🥑 abacate|🍔 hambúrguer|🍟 batata frita|🍕 pizza|🌭 cachorro quente|🌮 taco|🍿 pipoca|🍣 sushi|🍝 macarrão|🍜 noodles|🍚 arroz|🍗 frango|🥩 carne churrasco|🥗 salada|🥐 croissant|🍞 pão|🧀 queijo|🍳 ovo|🎂 aniversário bolo|🍰 doce|🍫 chocolate|🍩 donut|🍪 biscoito|🍦 sorvete|☕ café|🍵 chá|🧃 suco|🥤 refrigerante|🍺 cerveja|🍷 vinho|🥂 brinde|🧉 chimarrão'],
  ['Atividades','🎉','🎉 festa parabéns|🎊 confete|🎈 balão|🎁 presente|🎀 laço|🏆 troféu vitória|🥇 medalha ouro|⚽ futebol|🏀 basquete|🏐 vôlei|🎾 tênis|🏓 ping pong|🎮 jogo videogame|🎲 dado|🎯 alvo meta|🎨 arte design|🎭 teatro|🎵 música|🎶 notas musicais|🎸 guitarra|🎤 microfone|🎧 fone|🎬 filme cinema|📸 foto|🚀 foguete lançamento|✈️ avião|🚗 carro|🏍️ moto|🚲 bicicleta|🏠 casa|🏢 empresa|🏖️ férias|🏔️ montanha|🌆 cidade'],
  ['Objetos','💡','💡 ideia luz|💻 computador notebook|🖥️ monitor|⌨️ teclado|🖱️ mouse|📱 celular|🔋 bateria|🔌 tomada|🔧 ferramenta|⚙️ configuração|🔨 martelo|🛠️ manutenção|🔑 chave|🔒 seguro cadeado|🔓 aberto|📌 fixar|📎 anexo|🔗 link|📁 pasta|📄 documento|📝 nota escrever|📚 livros|📖 ler|📊 gráfico|📈 crescimento|📉 queda|📅 calendário prazo|⏰ alarme horário|⌛ tempo|📦 pacote|✉️ mensagem email|🔔 notificação|🔕 silencioso|💰 dinheiro|💸 gasto|💳 cartão crédito|🧾 recibo|🛒 carrinho|🧹 limpeza|🗑️ lixeira'],
  ['Símbolos','✅','✅ concluído feito certo|❌ erro cancelar|⚠️ atenção alerta|🚫 proibido|❗ importante exclamação|❓ pergunta|‼️ urgente|✔️ certo|➕ adicionar mais|➖ menos remover|🔄 atualizar|🔁 repetir|▶️ iniciar|⏸️ pausar|⏹️ parar|🔴 vermelho|🟠 laranja|🟡 amarelo|🟢 verde|🔵 azul|🟣 roxo|⚫ preto|⚪ branco|⬆️ cima|⬇️ baixo|⬅️ esquerda|➡️ direita|↩️ responder voltar|🔝 topo|🆕 novo|🆗 ok|🆘 ajuda|🇧🇷 brasil|🇵🇹 portugal|🇺🇸 estados unidos|🇦🇷 argentina']
].map(([name, icon, text]) => ({ name, icon, items: text.split('|').map(entry => { const i = entry.indexOf(' '); return { emoji: entry.slice(0,i), name: entry.slice(i+1) }; }) }));
const all = groups.flatMap(g => g.items);
const normalize = value => value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR');

export function mountEmojiPicker(host, { reaction, onChoose, onClose }) {
  host.replaceChildren();
  const picker = document.createElement('section'); picker.className = 'chat-emoji-picker'; picker.setAttribute('aria-label', reaction ? 'Escolher reação' : 'Emojis');
  const head = document.createElement('div'); head.className = 'chat-emoji-head';
  const title = document.createElement('strong'); title.textContent = reaction ? 'Reagir à mensagem' : 'Emojis';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'btn ghost'; close.textContent = '×'; close.setAttribute('aria-label','Fechar emojis'); close.onclick = onClose;
  head.append(title,close);
  const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Buscar emoji'; search.setAttribute('aria-label','Buscar emoji'); search.autocomplete = 'off';
  const nav = document.createElement('div'); nav.className = 'chat-emoji-categories'; nav.setAttribute('role','group'); nav.setAttribute('aria-label','Categorias de emojis');
  const caption = document.createElement('p'); caption.className = 'chat-emoji-caption'; caption.setAttribute('aria-live','polite');
  const grid = document.createElement('div'); grid.className = 'chat-emoji-grid'; grid.setAttribute('role','group'); grid.setAttribute('aria-label','Emojis disponíveis');
  let recent = [];
  try { const saved = JSON.parse(localStorage.getItem('gavyo-recent-emojis') || '[]'); if (Array.isArray(saved)) recent = saved.filter(e => all.some(item => item.emoji === e)).slice(0,24); } catch { /* Armazenamento opcional. */ }
  let selected = recent.length ? -1 : 0;
  const render = () => {
    const query = normalize(search.value.trim());
    const items = query ? all.filter(item => normalize(item.name).includes(query) || item.emoji === query) : selected < 0 ? recent.map(e => all.find(item => item.emoji === e)) : groups[selected].items;
    caption.textContent = query ? `${items.length} ${items.length === 1 ? 'resultado' : 'resultados'}` : selected < 0 ? 'Usados recentemente' : groups[selected].name;
    for (const el of nav.children) el.setAttribute('aria-pressed',String(Number(el.dataset.category) === selected && !query));
    grid.replaceChildren();
    for (const item of items) {
      const choice = document.createElement('button'); choice.type = 'button'; choice.className = 'chat-emoji-choice'; choice.textContent = item.emoji; choice.title = item.name; choice.setAttribute('aria-label',item.name);
      choice.onclick = () => {
        recent = [item.emoji,...recent.filter(e => e !== item.emoji)].slice(0,24);
        try { localStorage.setItem('gavyo-recent-emojis', JSON.stringify(recent)); } catch { /* Não impede o envio. */ }
        onChoose(item.emoji);
      };
      grid.append(choice);
    }
    if (!items.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = query ? 'Nenhum emoji encontrado.' : 'Seus emojis recentes aparecem aqui.'; grid.append(empty); }
  };
  for (const [index, group] of [{name:'Recentes',icon:'🕘'},...groups].entries()) {
    const tab = document.createElement('button'); tab.type = 'button'; tab.className = 'chat-emoji-category'; tab.textContent = group.icon; tab.title = group.name; tab.setAttribute('aria-label',group.name); tab.dataset.category = index - 1;
    tab.onclick = () => { selected = index - 1; search.value = ''; render(); }; nav.append(tab);
  }
  search.addEventListener('input',render);
  picker.append(head,search,nav,caption,grid); host.append(picker); render(); close.focus({preventScroll:true});
}
