const initialAdminId = '017c11c3-67da-46a9-b8bc-97e8fdab8ff8';
const duplicate = (error) => error.code === 'ER_DUP_ENTRY' || /UNIQUE constraint failed/.test(error.message);

export async function setupWorkspace(store, env = process.env, { onlyWhenEmpty = false } = {}) {
  const empty = (await store.members()).length === 0;
  if (onlyWhenEmpty && !empty) return;
  const names = new Set((env.INITIAL_PROJECTS || 'GAVYO Auto').split(',').map((name) => name.trim()).filter(Boolean));
  const projects = await store.projects();
  for (const name of names) {
    if (projects.some((project) => project.name === name)) continue;
    try {
      await store.createProject({ name });
    } catch (error) {
      if (!duplicate(error)) throw error;
    }
  }
  if (empty) {
    try {
      await store.createMember({ name: env.ADMIN_NAME, pin: env.ADMIN_PIN || undefined, role: 'admin' }, initialAdminId);
    } catch (error) {
      if (!duplicate(error)) throw error;
    }
  }
}
