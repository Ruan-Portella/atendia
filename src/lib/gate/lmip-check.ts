import { LMIP_FITOTERAPICOS, LMIP_SINTETICOS } from "./lmip";

/*
 * Remédio da base: isento de prescrição (MIP, regulamentado: 18+ e venda fora do chat) ou com
 * receita (proibido). A IA só lê o fármaco, a forma e a concentração no texto da empresa; quem
 * decide é esta conferência, contra a lista oficial da Anvisa (IN 285/2024). Fora da lista, forma
 * que a lista não traz ou concentração acima do máximo = receita. Sem forma ou concentração no
 * texto, vale o fármaco (o texto não diz nada que o tire da lista).
 */

export interface LmipVerdict {
  status: "mip" | "receita";
  reason: string;
}

const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9+,.\s/%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Componentes de uma associação ("a + b"), já sem acento e sem o plural simples. */
const components = (farmaco: string) =>
  plain(farmaco)
    .split("+")
    .map((c) => c.trim())
    .filter(Boolean);

/** O componente do texto é o da lista? "dipirona sodica" casa com "dipirona" (sal e hidrato não mudam). */
const sameComponent = (fromText: string, fromList: string) => fromText === fromList || fromText.startsWith(`${fromList} `) || fromList.startsWith(`${fromText} `);

function sameDrug(fromText: string[], fromList: string[]): boolean {
  if (fromText.length !== fromList.length) return false;
  return fromText.every((t) => fromList.some((l) => sameComponent(t, l)));
}

/** Formas da lista ("Comprimido, comprimido efervescente" / "Cápsula dura e cápsula dura de liberação retardada"). */
const formsOf = (forma: string) =>
  plain(forma)
    .split(/,| e (?=[a-z])/)
    .map(singular)
    .filter(Boolean);

/** "comprimidos revestidos" → "comprimido revestido" (plural simples, palavra por palavra). */
function singular(s: string) {
  return s
    .trim()
    .split(" ")
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join(" ");
}

export interface Concentration {
  values: number[];
  unit: string; // mg | mg/ml | mg/g | ui/g …
}

/** "400 + 200 mg", "11,5 mg/mL", "1 g", "200 mg/5 mL", "2%". null se não der para ler. */
export function parseConcentration(raw: string): Concentration | null {
  const s = plain(raw).replace(/(\d),(\d)/g, "$1.$2");
  // "200 mg/5 ml" → por mL
  const perVolume = /^([\d.]+)\s*mg\s*\/\s*([\d.]+)\s*ml$/.exec(s);
  if (perVolume) return { values: [Number(perVolume[1]) / Number(perVolume[2])], unit: "mg/ml" };
  const nums = [...s.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  if (!nums.length) return null;
  const unitMatch = /(mcg|µg|ug|mg|ui|u|g|ml|%)(\s*\/\s*(ml|g|kg|dose))?\s*$/.exec(s);
  if (!unitMatch) return null;
  let unit = `${unitMatch[1]}${unitMatch[3] ? `/${unitMatch[3]}` : ""}`;
  let values = nums;
  // tudo em miligramas para comparar
  if (unitMatch[1] === "g") {
    values = nums.map((n) => n * 1000);
    unit = unit.replace(/^g/, "mg");
  } else if (unitMatch[1] === "mcg" || unitMatch[1] === "µg" || unitMatch[1] === "ug") {
    values = nums.map((n) => n / 1000);
    unit = unit.replace(/^(mcg|µg|ug)/, "mg");
  }
  return { values, unit };
}

/** O valor do texto passa do máximo da lista? null = unidades que não dá para comparar. */
function exceeds(c: Concentration, max: Concentration): boolean | null {
  if (c.values.length !== max.values.length) return null;
  let values = c.values;
  let unit = c.unit;
  // 2% = 20 mg/g (creme) ou 20 mg/mL (solução)
  if (unit === "%" && (max.unit === "mg/g" || max.unit === "mg/ml")) {
    values = values.map((v) => v * 10);
    unit = max.unit;
  }
  if (unit !== max.unit) return null;
  return values.some((v, i) => v > max.values[i] + 1e-9);
}

export function lmipCheck(farmaco: string, forma?: string | null, concentracao?: string | null): LmipVerdict {
  const names = components(farmaco);
  if (!names.length) return { status: "receita", reason: "remédio sem nome" };
  const entries = LMIP_SINTETICOS.filter((e) => sameDrug(names, components(e.farmaco)));
  if (!entries.length) {
    const plant = LMIP_FITOTERAPICOS.find((e) => sameDrug(names, components(e.especie)));
    return plant ? { status: "mip", reason: `fitoterápico isento (${plant.especie})` } : { status: "receita", reason: "fora da lista de isentos da Anvisa" };
  }
  let candidates = entries;
  if (forma?.trim()) {
    const f = singular(plain(forma));
    candidates = entries.filter((e) => formsOf(e.forma).includes(f));
    if (!candidates.length) return { status: "receita", reason: `forma "${forma}" fora da lista de isentos` };
  }
  if (concentracao?.trim()) {
    const c = parseConcentration(concentracao);
    if (c) {
      const checks = candidates.map((e) => {
        const max = parseConcentration(e.concentracaoMaxima);
        return max ? exceeds(c, max) : null;
      });
      // alguma forma da lista aceita essa concentração: isento; só "acima do máximo": receita
      if (checks.some((x) => x === false)) return { status: "mip", reason: "isento na forma e concentração" };
      if (checks.some((x) => x === true)) return { status: "receita", reason: `${concentracao} acima do máximo isento` };
    }
  }
  return { status: "mip", reason: "fármaco isento" };
}
