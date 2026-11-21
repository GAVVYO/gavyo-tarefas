/**
 * Commits do repositório do projeto, para a linha do tempo da Central de projetos.
 * Repositório público funciona sem nada; privado precisa de GITHUB_TOKEN (só leitura).
 * Guarda a resposta por 2 minutos para não gastar o limite da API do GitHub.
 */
const cache = new Map();
const REPO = /^[\w.-]+\/[\w.-]+$/;

export async function recentCommits(repository, branch = '') {
  const repo = String(repository || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').replace(/\/$/, '');
  if (!REPO.test(repo)) return { commits: [], note: repository ? 'Repositório no formato dono/nome (ex.: GAVVYO/gavyo-tarefas).' : '' };
  const key = `${repo}#${branch}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 120000) return hit.value;
  const url = new URL(`https://api.github.com/repos/${repo}/commits`);
  url.searchParams.set('per_page', '40');
  if (branch) url.searchParams.set('sha', branch);
  let value;
  try {
    const ask = (token) => fetch(url, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'gavyo-tarefas', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(6000)
    });
    let response = await ask(process.env.GITHUB_TOKEN);
    // Token vencido ou errado: repositório público ainda abre sem ele.
    if (response.status === 401 && process.env.GITHUB_TOKEN) response = await ask('');
    if (!response.ok) {
      value = { commits: [], note: response.status === 404
        ? 'Não consegui ler os commits: o repositório é privado (falta GITHUB_TOKEN no servidor) ou o nome está errado.'
        : `O GitHub não respondeu (${response.status}). Tento de novo em instantes.` };
    } else {
      const list = await response.json();
      value = { commits: list.map((item) => ({
        sha: item.sha, short: item.sha.slice(0, 7), message: String(item.commit?.message || '').slice(0, 2000),
        at: item.commit?.author?.date || item.commit?.committer?.date, url: item.html_url, branch: branch || '',
        by: { actor: item.author?.login || item.commit?.author?.name || 'alguém', source: 'GitHub', at: item.commit?.author?.date }
      })), note: '' };
    }
  } catch {
    value = { commits: [], note: 'Sem conexão com o GitHub agora.' };
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}
