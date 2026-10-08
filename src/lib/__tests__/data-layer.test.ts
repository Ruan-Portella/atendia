import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Camada única (spec "Cifra por campo"): mensagens, contatos, leads, perguntas sem resposta e
 * pedidos fora do assunto só são lidos e gravados pelo módulo dono, para a cifra da leva S entrar
 * num lugar só.
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

// chaves dos clientes (leva S): só o módulo único de chaves lê a tabela; leads, perguntas sem
// resposta e pedidos fora do assunto: só as camadas que cifram o que vem do contato
const OWNER: Record<string, string> = {
  messages: "lib/messages.ts",
  contacts: "lib/contacts.ts",
  client_keys: "lib/keys.ts",
  leads: "lib/leads.ts",
  unanswered: "lib/unanswered.ts",
  scope_refusals: "lib/scope-refusals.ts",
  // arquivos recebidos: o objeto no Storage sai antes da linha, num lugar só
  attachments: "lib/attachments.ts",
  // envios das campanhas (leva B3): telefone e variáveis cifrados
  campaign_sends: "lib/campaigns.ts",
};

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

  // a pergunta guardada do 18+ vai cifrada: só o fluxo do portão grava e lê (a cifra e a recifra
  // só citam o nome da coluna)
  it("só lib/gate/flow.ts usa a pergunta pendente do 18+", () => {
    const allowed = new Set(["lib/gate/flow.ts", "lib/field-cipher.ts", "lib/reencrypt.ts"]);
    const offenders = sourceFiles(SRC)
      .map((f) => relative(SRC, f).split(sep).join("/"))
      .filter((f) => !allowed.has(f))
      .filter((f) => /age_pending_question\b/.test(readFileSync(join(SRC, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
