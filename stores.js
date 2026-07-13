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
  const e = new Error(`${hvem} avviste tokenet (401) — logg inn på nytt.`);
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
  if (r.status !== 404) throw new Error(`GitHub repo-sjekk: HTTP ${r.status}`);
  const c = await fetch("https://api.github.com/user/repos", {
    method: "POST", headers: GH_HEADERS(token),
    body: JSON.stringify({ name, private: true, auto_init: true, description: "flash-data: synk for flash-appen" }),
  });
  if (!c.ok) throw new Error(`Klarte ikke å opprette ${full}: HTTP ${c.status}`);
  return full;
}
