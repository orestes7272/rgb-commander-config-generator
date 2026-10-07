// Relative URLs so the app also works behind a reverse proxy sub-path.

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Request failed (${status})`);
    this.status = status;
    this.body = body;
    this.code = body?.code;
  }
}

async function request(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: 'Cannot reach the server. Is the container running?' });
  }
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, typeof data === 'object' ? data : { error: data });
  return data;
}

export const api = {
  info: () => request('GET', 'api/info'),
  settings: () => request('GET', 'api/settings'),
  saveSettings: (s) => request('PUT', 'api/settings', s),
  layout: () => request('GET', 'api/layout'),
  saveLayout: (l) => request('PUT', 'api/layout', l),
  projects: () => request('GET', 'api/projects'),
  project: (id) => request('GET', `api/projects/${encodeURIComponent(id)}`),
  createProject: (p) => request('POST', 'api/projects', p),
  saveProject: (p, force = false) => request('PUT', `api/projects/${encodeURIComponent(p.id)}${force ? '?force=1' : ''}`, p),
  deleteProject: (id, withFile = false) => request('DELETE', `api/projects/${encodeURIComponent(id)}${withFile ? '?file=1' : ''}`),
  duplicateProject: (id) => request('POST', `api/projects/${encodeURIComponent(id)}/duplicate`, {}),
  publish: (id, overwrite = false) => request('POST', `api/projects/${encodeURIComponent(id)}/publish`, { overwrite }),
  files: () => request('GET', 'api/files'),
  fileText: (name) => request('GET', `api/files/${encodeURIComponent(name)}`),
  fileDownloadUrl: (name) => `api/files/${encodeURIComponent(name)}?download=1`,
  deleteFile: (name) => request('DELETE', `api/files/${encodeURIComponent(name)}`),
  importFile: (name) => request('POST', `api/files/${encodeURIComponent(name)}/import`),
  backups: () => request('GET', 'api/backups'),
  backupText: (file, id) => request('GET', `api/backups/${encodeURIComponent(file)}/${encodeURIComponent(id)}`),
  backupDownloadUrl: (file, id) => `api/backups/${encodeURIComponent(file)}/${encodeURIComponent(id)}?download=1`,
  restoreBackup: (file, id) => request('POST', `api/backups/${encodeURIComponent(file)}/${encodeURIComponent(id)}/restore`, {}),
  importBackup: (file, id, name) => request('POST', `api/backups/${encodeURIComponent(file)}/${encodeURIComponent(id)}/import`, { name }),
  deleteBackup: (file, id) => request('DELETE', `api/backups/${encodeURIComponent(file)}/${encodeURIComponent(id)}`),
  deleteBackupGroup: (file) => request('DELETE', `api/backups/${encodeURIComponent(file)}`),
  deleteAllBackups: () => request('DELETE', 'api/backups'),
};
