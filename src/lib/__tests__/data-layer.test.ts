import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Camada única (spec "Cifra por campo"): mensagens e contatos só são lidos e gravados por
 * src/lib/messages.ts e src/lib/contacts.ts, para a cifra da leva S entrar num lugar só.
 * Este teste falha se outro arquivo usar as tabelas direto.
 */

const SRC = join(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

// chaves dos clientes (leva S): só o módulo único de chaves lê a tabela
const OWNER: Record<string, string> = { messages: "lib/messages.ts", contacts: "lib/contacts.ts", client_keys: "lib/keys.ts" };

describe("camada única de mensagens e contatos", () => {
  for (const [table, owner] of Object.entries(OWNER)) {
    it(`só ${owner} usa a tabela ${table}`, () => {
      const direct = new RegExp(`\\.from\\(\\s*["'\`]${table}["'\`]\\s*\\)`);
      // embed do PostgREST (ex.: select("id, messages(content)")) também lê a tabela
      const embedded = new RegExp(`select\\([^)]*\\b${table}\\s*\\(`);
      const offenders = sourceFiles(SRC)
        .map((f) => relative(SRC, f).split(sep).join("/"))
        .filter((f) => f !== owner)
        .filter((f) => {
          const code = readFileSync(join(SRC, f), "utf8");
          return direct.test(code) || embedded.test(code);
        });
      expect(offenders).toEqual([]);
    });
  }
});
