import fs from 'node:fs/promises';

export async function getDiskSpace(folders) {
  const results = [];
  for (const folder of folders) {
    try {
      const stats = await fs.statfs(folder.path);
      results.push({
        id: folder.id,
        label: folder.label,
        path: folder.path,
        free: Number(stats.bavail) * Number(stats.bsize),
        total: Number(stats.blocks) * Number(stats.bsize),
      });
    } catch {
      results.push({ id: folder.id, label: folder.label, path: folder.path, free: null, total: null });
    }
  }
  return results;
}
