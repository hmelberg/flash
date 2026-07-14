// Lagringsadaptere. Kontrakt (lik for GitHub og Drive):
//   load(path)  → {json, version} | null
//   save(path, contentStr, version?)   — e.conflict ved versjonskonflikt, e.auth ved 401
//   list(prefix) → ["<prefix><navn>", …]
// Adapterne er DOM-frie og tar tokens utenfra — testes med mocket fetch.

export const b64enc = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
export const b64dec = (b64) => {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
};

const GH_HEADERS = (token) => ({ Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" });
const authError = (hvem) => {
  const e = new Error(`${hvem} rejected the token (401) — sign in again.`);
  e.auth = true; return e;
};

export function githubStore({ token, repo }) {
  async function gh(path, opts = {}) {
    const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      ...opts, headers: { ...GH_HEADERS(token), ...opts.headers },
    });
    if (r.status === 401) throw authError("GitHub");
    return r;
  }
  return {
    async load(path) {
      const r = await gh(path);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`GitHub GET ${path}: HTTP ${r.status}`);
      const j = await r.json();
      return { json: JSON.parse(b64dec(j.content)), version: j.sha };
    },
    async save(path, contentStr, version) {
      const body = { message: `flash sync ${new Date().toISOString()}`, content: b64enc(contentStr) };
      if (version) body.sha = version;
      const r = await gh(path, { method: "PUT", body: JSON.stringify(body) });
      if (!r.ok) {
        const e = new Error(`GitHub PUT ${path}: HTTP ${r.status}`);
        e.conflict = r.status === 409 || r.status === 422;
        throw e;
      }
    },
    async list(prefix) {
      const r = await gh(prefix.replace(/\/$/, ""));
      if (r.status === 404) return [];
      if (!r.ok) throw new Error(`GitHub LIST ${prefix}: HTTP ${r.status}`);
      return (await r.json()).map(f => prefix + f.name);
    },
  };
}

export async function githubUser(token) {
  const r = await fetch("https://api.github.com/user", { headers: GH_HEADERS(token) });
  if (r.status === 401) throw authError("GitHub");
  if (!r.ok) throw new Error(`GitHub /user: HTTP ${r.status}`);
  return await r.json();
}

export async function ensureGithubRepo(token, login, name = "flash-data") {
  const full = `${login}/${name}`;
  const r = await fetch(`https://api.github.com/repos/${full}`, { headers: GH_HEADERS(token) });
  if (r.status === 401) throw authError("GitHub");
  if (r.ok) return full;
  if (r.status !== 404) throw new Error(`GitHub repo check: HTTP ${r.status}`);
  const c = await fetch("https://api.github.com/user/repos", {
    method: "POST", headers: GH_HEADERS(token),
    body: JSON.stringify({ name, private: true, auto_init: true, description: "flash-data: synk for flash-appen" }),
  });
  if (!c.ok) throw new Error(`Could not create ${full}: HTTP ${c.status}`);
  return full;
}

// Google Drive-adapter. Struktur: mappe "flash-data" i rot, undermappe "decks".
// drive.file-scope: vi ser kun filer appen selv har laget. version = fil-id.
export function driveStore({ getToken }) {
  const folderIds = {};   // "" = flash-data, "decks" = undermappen

  async function req(url, opts = {}) {
    const token = await getToken();
    const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...opts.headers } });
    if (r.status === 401) throw authError("Google");
    return r;
  }
  async function query(q) {
    const r = await req(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent("files(id,name)")}&pageSize=1000`);
    if (!r.ok) throw new Error(`Drive search: HTTP ${r.status}`);
    return (await r.json()).files || [];
  }
  async function folderId(sub, create) {
    const key = sub || "";
    if (folderIds[key]) return folderIds[key];
    const parent = key === "" ? "root" : await folderId("", create);
    if (parent === null) return null;
    const name = key === "" ? "flash-data" : sub;
    const found = await query(`name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parent}' in parents and trashed=false`);
    let id = found[0]?.id;
    if (!id) {
      if (!create) return null;
      const r = await req("https://www.googleapis.com/drive/v3/files", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parent] }),
      });
      if (!r.ok) throw new Error(`Drive folder: HTTP ${r.status}`);
      id = (await r.json()).id;
    }
    return (folderIds[key] = id);
  }
  const splitPath = (path) => {
    const i = path.indexOf("/");
    return i < 0 ? { sub: "", name: path } : { sub: path.slice(0, i), name: path.slice(i + 1) };
  };
  async function fileId(path, create) {
    const { sub, name } = splitPath(path);
    const parent = await folderId(sub, create);
    if (!parent) return null;
    const found = await query(`name='${name}' and '${parent}' in parents and trashed=false`);
    return found[0]?.id || null;
  }

  return {
    async load(path) {
      const id = await fileId(path, false);
      if (!id) return null;
      const r = await req(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
      if (!r.ok) throw new Error(`Drive GET ${path}: HTTP ${r.status}`);
      return { json: await r.json(), version: id };
    },
    async save(path, contentStr, version) {
      const id = version || await fileId(path, true);
      if (id) {
        const r = await req(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
          method: "PATCH", headers: { "content-type": "application/json" }, body: contentStr,
        });
        if (!r.ok) throw new Error(`Drive PUT ${path}: HTTP ${r.status}`);
        return;
      }
      const { sub, name } = splitPath(path);
      const parent = await folderId(sub, true);
      const boundary = "flashmp";
      const body = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify({ name, parents: [parent] }) +
        `\r\n--${boundary}\r\ncontent-type: application/json\r\n\r\n${contentStr}\r\n--${boundary}--`;
      const r = await req(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id`, {
        method: "POST", headers: { "content-type": `multipart/related; boundary=${boundary}` }, body,
      });
      if (!r.ok) throw new Error(`Drive create ${path}: HTTP ${r.status}`);
    },
    async list(prefix) {
      const sub = prefix.replace(/\/$/, "");
      const parent = await folderId(sub, false);
      if (!parent) return [];
      const files = await query(`'${parent}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`);
      return files.map(f => prefix + f.name);
    },
  };
}
