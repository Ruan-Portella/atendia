// Aplica as migrações de supabase/migrations que ainda não rodaram no banco.
//
// Roda antes do `next build` (ver package.json), então o código novo só vai ao ar com o banco
// já atualizado. Por segurança só age quando:
//   - VERCEL_ENV=production (deploy de produção na Vercel), ou
//   - MIGRATE_ON_BUILD=1, ou
//   - `npm run migrate` (flag --force).
// Precisa de DATABASE_URL (Supabase → Connect → Session pooler, porta 5432).
// Sem DATABASE_URL, avisa e segue o build sem migrar.
//
// Cada arquivo roda numa transação e fica registrado em public._migrations. Todas as
// migrações do projeto são idempotentes, então rodar de novo uma já aplicada à mão é seguro.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

const force = process.argv.includes("--force");
const enabled = force || process.env.MIGRATE_ON_BUILD === "1" || process.env.VERCEL_ENV === "production";
if (!enabled) {
  console.log("[migrate] pulado (só roda em produção, com MIGRATE_ON_BUILD=1 ou npm run migrate).");
  process.exit(0);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.warn("[migrate] DATABASE_URL não definida: migrações NÃO aplicadas. Configure na Vercel para automatizar.");
  process.exit(0);
}

const dir = join(process.cwd(), "supabase", "migrations");
const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

try {
  // trava para dois deploys simultâneos não migrarem juntos
  await sql`select pg_advisory_lock(hashtext('atendia_migrations'))`;
  await sql`create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now())`;
  await sql`alter table public._migrations enable row level security`;
  const done = new Set((await sql`select name from public._migrations`).map((r) => r.name));
  const pending = files.filter((f) => !done.has(f));
  if (!pending.length) console.log("[migrate] banco em dia.");
  for (const file of pending) {
    const body = await readFile(join(dir, file), "utf8");
    process.stdout.write(`[migrate] aplicando ${file}… `);
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into public._migrations (name) values (${file})`;
    });
    console.log("ok");
  }
} catch (e) {
  console.error("\n[migrate] falhou:", e.message);
  process.exitCode = 1; // falha o build: o código novo não sobe sem o banco certo
} finally {
  await sql.end({ timeout: 5 });
}
