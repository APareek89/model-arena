// Deploy this app to Vercel through the REST API, using a token that is scoped to a team.
// Usage: VERCEL_TOKEN=... VERCEL_TEAM_ID=team_xxx [HF_TOKEN=... GEMINI_API_KEY=... APP_ACCESS_KEY=...] node scripts/deploy-vercel.mjs
// Env values, when present, are upserted as encrypted production+preview variables before deploying.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const token = process.env.VERCEL_TOKEN;
const teamId = process.env.VERCEL_TEAM_ID;
const projectName = process.env.VERCEL_PROJECT || "model-arena";
const gitRepo = process.env.GITHUB_REPO || "";
if (!token || !teamId) { console.error("VERCEL_TOKEN and VERCEL_TEAM_ID are required"); process.exit(1); }

const API = "https://api.vercel.com";
const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const q = (extra = "") => `?teamId=${teamId}${extra}`;

async function call(method, path, body) {
  const r = await fetch(API + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${j?.error?.message || text.slice(0, 300)}`);
  return j;
}

const SKIP = new Set(["node_modules", ".next", ".git", ".vercel", "out"]);
function listFiles(dir, root = dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name === ".DS_Store" || name.startsWith(".env")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) listFiles(p, root, acc); else acc.push(relative(root, p));
  }
  return acc;
}

async function ensureProject() {
  try {
    return await call("GET", `/v9/projects/${projectName}${q()}`);
  } catch {
    const body = { name: projectName, framework: "nextjs" };
    if (gitRepo) body.gitRepository = { type: "github", repo: gitRepo };
    try { return await call("POST", `/v11/projects${q()}`, body); }
    catch (e) {
      if (!gitRepo) throw e;
      console.warn("Project creation with GitHub link failed, creating without link:", e.message.slice(0, 160));
      return await call("POST", `/v11/projects${q()}`, { name: projectName, framework: "nextjs" });
    }
  }
}

async function upsertEnv(projectId) {
  const items = ["HF_TOKEN", "GEMINI_API_KEY", "APP_ACCESS_KEY"].filter((k) => process.env[k]).map((key) => ({
    key, value: process.env[key], type: "encrypted", target: ["production", "preview"],
  }));
  if (!items.length) { console.log("No env values supplied; skipping env upsert"); return; }
  await call("POST", `/v10/projects/${projectId}/env${q("&upsert=true")}`, items);
  console.log("Env upserted:", items.map((i) => i.key).join(", "));
}

async function deploy() {
  const files = listFiles(process.cwd()).map((file) => ({ file, data: readFileSync(file, "utf8") }));
  console.log(`Uploading ${files.length} files`);
  const dep = await call("POST", `/v13/deployments${q("&forceNew=1")}`, {
    name: projectName, project: projectName, target: "production", files,
    projectSettings: { framework: "nextjs" },
  });
  console.log("Deployment created:", dep.id, dep.url);
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const d = await call("GET", `/v13/deployments/${dep.id}${q()}`);
    process.stdout.write(`  ${d.readyState}\n`);
    if (d.readyState === "READY") return d;
    if (["ERROR", "CANCELED"].includes(d.readyState)) throw new Error(`Deployment ${d.readyState}: ${d.errorMessage || ""}`);
  }
  throw new Error("Timed out waiting for the deployment");
}

const project = await ensureProject();
console.log("Project:", project.name, project.id, project.link ? `linked to ${project.link.type}:${project.link.org}/${project.link.repo}` : "not linked to git");
await upsertEnv(project.id);
const d = await deploy();
const domains = await call("GET", `/v9/projects/${project.id}/domains${q()}`).catch(() => ({ domains: [] }));
console.log("READY:", `https://${d.url}`);
for (const dom of domains.domains || []) console.log("Domain:", `https://${dom.name}`);
