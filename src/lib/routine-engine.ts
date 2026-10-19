import type { SupabaseClient } from "@supabase/supabase-js";
import { tool, type Tool } from "ai";
import { z } from "zod";
import { openNullable, sealField, scopeOfConversation } from "./field-cipher";
import { hasPack } from "./entitlements";
import { findMessage } from "./messages";
import { IG_APP_AUTHOR, PHONE_AUTHOR } from "./authors";
import { parseComponents, type MessageComponent } from "./components";
import { DATA_KIND_LABEL, routineUsesActions, type DataKind, type RoutineRow, type RoutineStep } from "./routines";
import type { ActionIdentity } from "./actions";
import {
  FIXED_KINDS,
  MAX_ATTEMPTS,
  ROUTINE_TIMEOUT_MS,
  failButtons,
  findValue,
  keywordRoutine,
  nextFrom,
  parseRoutineButton,
  resultDestination,
  resultKey,
  routinePrompt,
  stepButtons,
  stepInstruction,
  typedChoice,
  validateValue,
  variablesLine,
  type EndReason,
  type NextStep,
  type RoutineClick,
  type RoutineVariables,
} from "./routine-run";

/*
 * Roteiros na conversa (leva B2', parte 2a): o roteiro em andamento fica em routine_runs (um por
 * conversa), com o passo atual e os dados já conferidos (cifrados com a chave do cliente). Antes da
 * IA, o BoaVoz resolve o que não depende dela: botão do passo, escolha digitada, dado de formato
 * fixo, palavra-chave e o fim por prazo, por roteiro alterado ou porque a equipe entrou. Na vez da
 * IA, as ferramentas começam, avançam e cancelam o roteiro; os botões do passo vão sozinhos.
 */

/** Texto fixo do "Cancelar" depois das 3 tentativas. */
export const ROUTINE_CANCELLED_TEXT = "Tudo bem, parei por aqui. Se precisar de mais alguma coisa, é só escrever.";

/**
 * A identidade da conversa para o roteiro (parte 2c), montada pelo canal (routine-identity.ts): o
 * roteiro pula os passos marcados com a pessoa já identificada, grava a identidade que a ação do
 * passo devolveu e espera a escolha da conta quando ela tem mais de uma.
 */
export interface RoutineIdentityPort {
  identified(): boolean;
  choosing(): boolean;
  accountButtons(): MessageComponent | null;
  /** null: a conversa já tem identidade de fora (pareamento ou token), que vence. */
  apply(identity: ActionIdentity): Promise<{ choosing: boolean; name: string | null; accounts: number } | null>;
}

export interface ActiveRun {
  id: string;
  conversationId: string;
  botId: string;
  routine: RoutineRow;
  stepId: string;
  variables: RoutineVariables;
  attempts: number;
  failing: boolean;
  lastContactAt: string;
  updatedAt: string;
  routineVersion: string;
  /** Esperando a pessoa escolher a conta: o resultado da ação que vale depois da escolha. */
  heldResult: string | null;
}

const RUN_COLS = "id, conversation_id, bot_id, step_id, variables_enc, attempts, failing, last_contact_at, updated_at, routine_version, held_result, routines(*)";

type RunRow = {
  id: string;
  conversation_id: string;
  bot_id: string;
  step_id: string;
  variables_enc: string | null;
  attempts: number;
  failing: boolean;
  last_contact_at: string;
  updated_at: string;
  routine_version: string;
  held_result?: string | null;
  routines: RoutineRow | RoutineRow[] | null;
};

const label = (kind: DataKind) => (kind === "regex" ? "dado" : DATA_KIND_LABEL[kind]);
const currentStep = (run: ActiveRun): RoutineStep => run.routine.steps.find((s) => s.id === run.stepId) ?? run.routine.steps[0];

async function openVariables(raw: string | null): Promise<RoutineVariables> {
  const s = await openNullable("routine_runs.variables_enc", raw);
  if (!s) return {};
  try {
    const v = JSON.parse(s) as RoutineVariables;
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

const sealVariables = async (conversationId: string, v: RoutineVariables) => (Object.keys(v).length ? sealField("routine_runs.variables_enc", JSON.stringify(v), await scopeOfConversation(conversationId)) : null);

/* ------------------------------------------------------------------ estado no banco */

/** O roteiro em andamento na conversa, ou null. Roteiro apagado no meio: acaba aqui (routine_changed). */
export async function loadActiveRun(db: SupabaseClient, conversationId: string): Promise<ActiveRun | null> {
  const { data } = await db.from("routine_runs").select(RUN_COLS).eq("conversation_id", conversationId).eq("status", "active").maybeSingle();
  if (!data) return null;
  const r = data as unknown as RunRow;
  const routine = Array.isArray(r.routines) ? (r.routines[0] ?? null) : r.routines;
  if (!routine) {
    await finishRun(db, r.id, "abandoned", "routine_changed");
    return null;
  }
  return { id: r.id, conversationId: r.conversation_id, botId: r.bot_id, routine, stepId: r.step_id, variables: await openVariables(r.variables_enc), attempts: r.attempts, failing: r.failing, lastContactAt: r.last_contact_at, updatedAt: r.updated_at, routineVersion: r.routine_version, heldResult: r.held_result ?? null };
}

/** Fim do roteiro: concluído ou abandonado (com o motivo). As variáveis saem na hora. */
async function finishRun(db: SupabaseClient, runId: string, status: "completed" | "abandoned", reason: EndReason | null): Promise<void> {
  const now = new Date().toISOString();
  await db.from("routine_runs").update({ status, end_reason: reason, variables_enc: null, ended_at: now, updated_at: now }).eq("id", runId).eq("status", "active");
}

const ABANDON = (reason: EndReason) => {
  const now = new Date().toISOString();
  return { status: "abandoned", end_reason: reason, variables_enc: null, ended_at: now, updated_at: now };
};

/** A IA deixou de responder (Assumir, pausa pela API, eco do celular, só humano), o contato pediu a equipe ou o contexto trocou. */
export async function endActiveRoutine(db: SupabaseClient, conversationId: string, reason: EndReason): Promise<void> {
  const { error } = await db.from("routine_runs").update(ABANDON(reason)).eq("conversation_id", conversationId).eq("status", "active");
  if (error) console.error("roteiro: não encerrou", error.message);
}

/** Roteiro salvo, desligado ou apagado: os em andamento acabam (routine_changed). */
export async function endRoutineRuns(db: SupabaseClient, routineId: string, reason: EndReason): Promise<void> {
  const { error } = await db.from("routine_runs").update(ABANDON(reason)).eq("routine_id", routineId).eq("status", "active");
  if (error) console.error("roteiro: não encerrou", error.message);
}

/** Bot pausado pelo dono: todos os roteiros dele acabam (handoff). */
export async function endBotRoutineRuns(db: SupabaseClient, botId: string, reason: EndReason): Promise<void> {
  const { error } = await db.from("routine_runs").update(ABANDON(reason)).eq("bot_id", botId).eq("status", "active");
  if (error) console.error("roteiro: não encerrou", error.message);
}

/** Varredura diária: roteiro sem mensagem do contato há 24 horas acaba (timeout). */
export async function sweepRoutineTimeouts(db: SupabaseClient): Promise<number> {
  const { data, error } = await db
    .from("routine_runs")
    .update(ABANDON("timeout"))
    .eq("status", "active")
    .lt("last_contact_at", new Date(Date.now() - ROUTINE_TIMEOUT_MS).toISOString())
    .select("id");
  if (error) throw new Error(`roteiros vencidos: ${error.message}`);
  return data?.length ?? 0;
}

/**
 * Cancelar na confirmação de uma ação "executa" que é o passo atual do roteiro: o roteiro acaba,
 * cancelado pelo contato (B2', parte 2b).
 */
export async function cancelRoutineAction(db: SupabaseClient, conversationId: string, actionId: string): Promise<void> {
  const run = await loadActiveRun(db, conversationId);
  const step = run ? currentStep(run) : null;
  if (!run || step?.type !== "acao") return;
  const { data } = await db.from("actions").select("name").eq("id", actionId).maybeSingle();
  if (data?.name === step.action) await finishRun(db, run.id, "abandoned", "cancelled");
}

/**
 * Confirmar de uma ação "executa" que é o passo atual: o roteiro anda pelo resultado da chamada.
 * Devolve o que a IA precisa saber e, se o destino é a equipe, o motivo do pedido de atendente
 * (o canal pede e avisa a pessoa junto da resposta).
 */
export async function applyConfirmedAction(
  db: SupabaseClient,
  i: { conversationId: string; action: string; status: string; outcome: string | null; declared: string[]; waPhone: string | null },
): Promise<{ note: string | null; handoff: string | null }> {
  const run = await loadActiveRun(db, i.conversationId);
  const step = run ? currentStep(run) : null;
  if (!run || step?.type !== "acao" || step.action !== i.action) return { note: null, handoff: null };
  const key = resultKey(i, i.declared);
  const moved = await moveTo(db, run, nextFrom(run.routine.steps, step.id, resultDestination(step, key)), { texts: [], waPhone: i.waPhone, why: `Roteiro "${run.routine.name}": ${i.action} (${key})`, contact: true });
  if (moved.kind === "handoff") return { note: `Roteiro "${run.routine.name}": depois desta ação, a conversa vai para a equipe.`, handoff: moved.reason };
  if (moved.kind === "completed") return { note: `O roteiro "${run.routine.name}" terminou com esta ação: siga a conversa normalmente.`, handoff: null };
  return { note: `A ação do passo foi confirmada e chamada (resultado: ${key}).`, handoff: null };
}

/** Pedido do titular: os roteiros destas conversas saem (as variáveis são dado do contato). */
export async function deleteRoutineRunsOfConversations(db: SupabaseClient, conversationIds: string[]): Promise<number> {
  if (!conversationIds.length) return 0;
  const { count, error } = await db.from("routine_runs").delete({ count: "exact" }).in("conversation_id", conversationIds);
  if (error) throw new Error(`roteiros do contato: ${error.message}`);
  return count ?? 0;
}

async function saveRun(db: SupabaseClient, run: ActiveRun, patch: { stepId?: string; variables?: RoutineVariables; attempts?: number; failing?: boolean; contact?: boolean; heldResult?: string | null }): Promise<void> {
  const now = new Date().toISOString();
  const stepId = patch.stepId ?? run.stepId;
  const attempts = patch.attempts ?? run.attempts;
  const failing = patch.failing ?? run.failing;
  const update: Record<string, unknown> = { step_id: stepId, step_index: run.routine.steps.findIndex((s) => s.id === stepId) + 1, attempts, failing, updated_at: now, ...(patch.contact ? { last_contact_at: now } : {}) };
  if (patch.variables) update.variables_enc = await sealVariables(run.conversationId, patch.variables);
  if (patch.heldResult !== undefined) update.held_result = patch.heldResult;
  await db.from("routine_runs").update(update).eq("id", run.id).eq("status", "active");
  run.stepId = stepId;
  run.attempts = attempts;
  run.failing = failing;
  run.updatedAt = now;
  if (patch.variables) run.variables = patch.variables;
  if (patch.contact) run.lastContactAt = now;
  if (patch.heldResult !== undefined) run.heldResult = patch.heldResult;
}

export type Moved = { kind: "step" } | { kind: "completed" } | { kind: "handoff"; reason: string };

/**
 * Vai para o próximo lugar: grava o passo (zerando as tentativas), conclui ou passa para a equipe
 * (abandonado, handoff). No passo novo que pede um dado, já preenche o que dá: o telefone desta
 * conversa do WhatsApp ou o dado que veio nas mensagens desta vez (nunca um valor já usado). Com a
 * pessoa já identificada, os passos marcados para identificar ficam para trás (o dado sem valor e
 * a ação pelo destino do "ok").
 */
async function moveTo(db: SupabaseClient, run: ActiveRun, next: NextStep, ctx: { texts: string[]; waPhone: string | null; why: string; contact?: boolean; endReason?: EndReason; identified?: boolean }): Promise<Moved> {
  let n = next;
  let vars = run.variables;
  for (let guard = 0; guard <= run.routine.steps.length; guard++) {
    // acabou por causa da ação indisponível: abandonado com esse motivo, mesmo no "encerrar"
    if (n.kind === "completed") {
      await finishRun(db, run.id, ctx.endReason ? "abandoned" : "completed", ctx.endReason ?? null);
      return { kind: "completed" };
    }
    if (n.kind === "handoff") {
      await finishRun(db, run.id, "abandoned", ctx.endReason ?? "handoff");
      return { kind: "handoff", reason: ctx.why };
    }
    const step = n.step;
    if ((step.type === "dado" || step.type === "acao") && step.skip_identified && ctx.identified) {
      n = nextFrom(run.routine.steps, step.id, step.type === "dado" ? step.next : resultDestination(step, "ok"));
      continue;
    }
    if (step.type === "dado") {
      const phone = step.kind === "telefone" && ctx.waPhone ? validateValue("telefone", ctx.waPhone) : null;
      const found = phone ? { value: phone } : findValue(step.kind, ctx.texts);
      if (found && "value" in found && !Object.values(vars).some((v) => v.value === found.value)) {
        vars = { ...vars, [step.variable]: { kind: step.kind, value: found.value } };
        n = nextFrom(run.routine.steps, step.id, step.next);
        continue;
      }
    }
    await saveRun(db, run, { stepId: step.id, variables: vars, attempts: 0, failing: false, contact: ctx.contact });
    return { kind: "step" };
  }
  // destinos em volta só de passos preenchidos sozinhos: para no passo atual
  await saveRun(db, run, { variables: vars, contact: ctx.contact });
  return { kind: "step" };
}

async function startRun(db: SupabaseClient, i: { botId: string; conversationId: string; routine: RoutineRow; by: "ia" | "palavra"; texts: string[]; waPhone: string | null; identified?: boolean }): Promise<{ run: ActiveRun | null; moved: Moved }> {
  const first = i.routine.steps[0];
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("routine_runs")
    .insert({ conversation_id: i.conversationId, bot_id: i.botId, routine_id: i.routine.id, routine_name: i.routine.name, routine_version: i.routine.updated_at, step_id: first.id, step_index: 1, steps_total: i.routine.steps.length, started_by: i.by, last_contact_at: now, updated_at: now })
    .select("id")
    .single();
  if (error || !data) {
    // outro roteiro começou ao mesmo tempo nesta conversa (um por vez): segue o que está valendo
    return { run: await loadActiveRun(db, i.conversationId), moved: { kind: "step" } };
  }
  const run: ActiveRun = { id: data.id as string, conversationId: i.conversationId, botId: i.botId, routine: i.routine, stepId: first.id, variables: {}, attempts: 0, failing: false, lastContactAt: now, updatedAt: now, routineVersion: i.routine.updated_at, heldResult: null };
  const moved = await moveTo(db, run, { kind: "step", step: first }, { texts: i.texts, waPhone: i.waPhone, why: `Roteiro "${i.routine.name}"`, identified: i.identified });
  return { run: moved.kind === "step" ? run : null, moved };
}

/**
 * A equipe entrou depois do último passo (Assumir, pausa pela API ou resposta pelo celular ou pelo
 * app): rede de segurança dos ganchos. Mensagem mandada pela API sem pausa não conta (a IA segue).
 */
async function pausedSince(db: SupabaseClient, run: ActiveRun): Promise<boolean> {
  const [{ data: conv }, agent] = await Promise.all([
    db.from("conversations").select("takeover_at, ai_paused_at").eq("id", run.conversationId).maybeSingle(),
    findMessage(db, { conversationId: run.conversationId, roles: ["agent"], authors: [PHONE_AUTHOR, IG_APP_AUTHOR], createdAfter: run.updatedAt }, ["id"] as const),
  ]);
  const after = (t: unknown) => typeof t === "string" && Date.parse(t) > Date.parse(run.updatedAt);
  return after(conv?.takeover_at) || after(conv?.ai_paused_at) || Boolean(agent);
}

/* ------------------------------------------------------------------ antes da IA */

export interface RoutineTurn {
  /** Roteiro em andamento para a vez da IA (depois do que o BoaVoz já resolveu). */
  run: ActiveRun | null;
  /** Roteiros ligados que a IA pode começar (sem o pacote, os que têm passo de ação ficam de fora). */
  available: RoutineRow[];
  /** O que aconteceu nesta mensagem, para a IA ("CPF conferido", "escolheu Sim"). */
  note: string | null;
  /** Sem a IA: cancelado ou equipe pelo botão (o canal manda o texto ou o pedido de atendente). */
  fixed: { kind: "cancelled"; text: string } | { kind: "handoff"; reason: string } | null;
  /** Conversa aberta aqui (site: a palavra-chave começou o roteiro antes da conversa existir). */
  conversationId: string | null;
}

export const noRoutineTurn = (conversationId: string | null = null): RoutineTurn => ({ run: null, available: [], note: null, fixed: null, conversationId });

/**
 * Antes da IA: confere se o roteiro em andamento ainda vale (prazo, roteiro alterado, equipe que
 * entrou), resolve o toque nos botões do passo e a escolha digitada, confere o dado de formato fixo e
 * começa o roteiro pela palavra-chave. consume false: a mensagem já foi usada (Confirmar, resposta
 * de 18+), só o estado é conferido.
 */
export async function routinePreTurn(
  db: SupabaseClient,
  i: {
    bot: { id: string; agency_id: string };
    conversationId: string | null;
    texts: string[];
    buttonId: string | null;
    waPhone: string | null;
    consume?: boolean;
    openConversation?: () => Promise<string>;
    /** O que já aconteceu com o roteiro nesta mensagem (o Confirmar de uma ação do passo). */
    note?: string | null;
    /** A identidade da conversa (parte 2c): pula os passos marcados e solta o roteiro que esperava a escolha da conta. */
    identity?: { identified: boolean; choosing: boolean };
  },
): Promise<RoutineTurn> {
  const { data: rows } = await db.from("routines").select("*").eq("bot_id", i.bot.id).eq("active", true).order("name");
  const all = (rows ?? []) as unknown as RoutineRow[];
  const integrations = all.some(routineUsesActions) ? await hasPack(db, i.bot.agency_id, "integracoes") : true;
  const available = all.filter((r) => integrations || !routineUsesActions(r));
  let conversationId = i.conversationId;
  let run = conversationId ? await loadActiveRun(db, conversationId) : null;
  if (!available.length && !run) return noRoutineTurn(conversationId);
  const turn: RoutineTurn = { run: null, available, note: i.note ?? null, fixed: null, conversationId };
  const consume = i.consume !== false;
  const text = i.texts.at(-1) ?? "";
  const identified = Boolean(i.identity?.identified);

  // 1. o roteiro em andamento ainda vale?
  if (run) {
    const current = available.find((r) => r.id === run!.routine.id);
    const changed = !current || Date.parse(current.updated_at) > Date.parse(run.routineVersion);
    const reason: EndReason | null = changed ? "routine_changed" : Date.now() - Date.parse(run.lastContactAt) > ROUTINE_TIMEOUT_MS ? "timeout" : (await pausedSince(db, run)) ? "handoff" : null;
    if (reason) {
      await finishRun(db, run.id, "abandoned", reason);
      run = null;
    }
  }

  // 1b. roteiro esperando a escolha da conta (parte 2c): escolhida, segue pelo resultado da ação;
  // sem a identidade (desconectou, venceu), acaba; ainda escolhendo, a mensagem não anda o roteiro
  if (run?.heldResult) {
    if (!identified) {
      await finishRun(db, run.id, "abandoned", "context_changed");
      run = null;
    } else if (i.identity?.choosing) {
      if (consume) await saveRun(db, run, { contact: true });
      return { ...turn, run };
    } else {
      const step = currentStep(run);
      const held = run.heldResult;
      await saveRun(db, run, { heldResult: null, contact: true });
      if (step.type === "acao") {
        const moved = await moveTo(db, run, nextFrom(run.routine.steps, step.id, resultDestination(step, held)), { texts: [], waPhone: i.waPhone, why: `Roteiro "${run.routine.name}": ${step.action} (${held})`, contact: true, identified });
        if (moved.kind === "handoff") return { ...turn, fixed: { kind: "handoff", reason: moved.reason } };
        if (moved.kind === "completed") return { ...turn, note: [turn.note, `O roteiro "${run.routine.name}" terminou: siga a conversa normalmente.`].filter(Boolean).join(" ") };
      }
      return { ...turn, run };
    }
  }

  // 2. toque num botão do roteiro, ou a escolha digitada com os botões dele na última mensagem
  let click: RoutineClick | null = consume ? parseRoutineButton(i.buttonId) : null;
  let typed = false;
  if (consume && run && !i.buttonId && conversationId && (run.failing || currentStep(run).type === "botoes")) {
    const last = await findMessage(db, { conversationId, roles: ["assistant", "agent"], delivered: true, newestFirst: true }, ["components_enc"] as const);
    const comp = parseComponents(last?.components_enc ?? null);
    if (comp?.type === "options" && comp.options.every((o) => o.id.startsWith(`rt:${run!.id}:`))) {
      const idx = typedChoice(text, comp.options);
      if (idx !== null) {
        click = parseRoutineButton(comp.options[idx].id);
        typed = true;
      }
    }
  }
  if (click && run && click.runId === run.id) {
    if ("fail" in click) {
      if (run.failing) {
        if (click.fail === "cancelar") {
          await finishRun(db, run.id, "abandoned", "cancelled");
          return { ...turn, fixed: { kind: "cancelled", text: ROUTINE_CANCELLED_TEXT } };
        }
        await finishRun(db, run.id, "abandoned", "handoff");
        return { ...turn, fixed: { kind: "handoff", reason: `Roteiro "${run.routine.name}": não deu para conferir o dado pedido` } };
      }
    } else if (click.stepId === run.stepId) {
      const step = currentStep(run);
      const option = step.type === "botoes" ? step.options[click.index] : undefined;
      if (step.type === "botoes" && option) {
        if (step.variable) run.variables = { ...run.variables, [step.variable]: { kind: "escolha", value: option.title } };
        const moved = await moveTo(db, run, nextFrom(run.routine.steps, step.id, option.next), { texts: [], waPhone: i.waPhone, why: `Roteiro "${run.routine.name}": ${option.title}`, contact: true, identified });
        if (moved.kind === "handoff") return { ...turn, fixed: { kind: "handoff", reason: moved.reason } };
        const chose = `A pessoa escolheu "${option.title}"${typed ? " (digitou a opção)" : ""}.`;
        if (moved.kind === "completed") return { ...turn, note: `${chose} O roteiro "${run.routine.name}" terminou: siga a conversa normalmente.` };
        return { ...turn, run, note: chose };
      }
    }
  }

  // 3. passo que pede um dado de formato fixo: o BoaVoz confere nas mensagens desta vez
  if (consume && run) {
    const step = currentStep(run);
    if (step.type === "dado" && FIXED_KINDS.has(step.kind)) {
      const found = findValue(step.kind, i.texts);
      if (found && "value" in found) {
        run.variables = { ...run.variables, [step.variable]: { kind: step.kind, value: found.value } };
        const moved = await moveTo(db, run, nextFrom(run.routine.steps, step.id, step.next), { texts: [], waPhone: i.waPhone, why: `Roteiro "${run.routine.name}"`, contact: true, identified });
        if (moved.kind === "handoff") return { ...turn, fixed: { kind: "handoff", reason: moved.reason } };
        const ok = `${label(step.kind)} conferido: ${found.value}.`;
        if (moved.kind === "completed") return { ...turn, note: `${ok} O roteiro "${run.routine.name}" terminou: siga a conversa normalmente.` };
        return { ...turn, run, note: ok };
      }
      if (found && "invalid" in found) {
        const attempts = run.attempts + 1;
        const failing = attempts >= MAX_ATTEMPTS;
        await saveRun(db, run, { attempts, failing, contact: true });
        const why = step.kind === "cpf" || step.kind === "cnpj" || step.kind === "cpf_cnpj" ? " (o dígito verificador não bate)" : "";
        return { ...turn, run, note: failing ? null : `O ${label(step.kind)} que a pessoa mandou não confere${why}. Peça para conferir e mandar de novo (tentativa ${attempts} de ${MAX_ATTEMPTS}), sem repetir o número.` };
      }
      await saveRun(db, run, { contact: true });
      return { ...turn, run, note: run.failing ? null : `A pessoa ainda não mandou o ${label(step.kind)}. Se ela perguntou outra coisa, responda e peça o ${label(step.kind)} de novo.` };
    }
  }

  // 4. sem roteiro: a mensagem que é só a palavra-chave começa um
  if (consume && !run && !i.buttonId) {
    const routine = keywordRoutine(text, available);
    if (routine) {
      conversationId ??= i.openConversation ? await i.openConversation() : null;
      if (conversationId) {
        const started = await startRun(db, { botId: i.bot.id, conversationId, routine, by: "palavra", texts: [], waPhone: i.waPhone, identified });
        const begun = `A pessoa mandou a palavra-chave "${text.trim()}": o roteiro "${routine.name}" começou.`;
        if (started.moved.kind === "handoff") return { ...turn, conversationId, fixed: { kind: "handoff", reason: started.moved.reason } };
        return { ...turn, conversationId, run: started.run, note: started.moved.kind === "completed" ? `${begun} Ele já terminou: siga a conversa normalmente.` : begun };
      }
    }
  }

  if (run && consume) await saveRun(db, run, { contact: true });
  return { ...turn, run };
}

/* ------------------------------------------------------------------ na vez da IA */

export interface RoutineSession {
  tools: Record<string, Tool>;
  /**
   * Antes da IA: a ação do passo atual que não está entre as ferramentas desta vez (desativada, sem
   * o pacote, nível do contato, 5 "não encontrado") segue o destino de erro (step_unavailable).
   * Na vez depois de um Confirmar, as "executa" ficam de fora de propósito: não conta.
   */
  prepare(offered: Set<string>, o?: { confirmRound?: boolean }): Promise<void>;
  /** Passo de ação: a ação e os dados do roteiro (os parâmetros com o mesmo nome vão preenchidos). */
  actionStep(): { action: string; variables: RoutineVariables } | null;
  /** Resultado da ação do passo: o roteiro anda pelo destino do resultado (o que vai junto do resultado para a IA). */
  onActionResult(action: string, r: { status: string; outcome?: string | null; identity?: ActionIdentity | null }, declared: string[]): Promise<Record<string, unknown> | null>;
  /** O bloco do roteiro para a IA (depois do histórico), ou null. */
  prompt(): string | null;
  /** Os botões do passo em que a vez terminou (ou equipe e cancelar, depois das 3 tentativas). */
  component(): MessageComponent | null;
  /** Passo de botões: a IA não mostra opções próprias. */
  blocksOptions(): boolean;
  /**
   * As ações dos outros passos do roteiro quando o passo atual é uma ação (ela pode identificar a
   * pessoa no meio da vez, e a próxima ação já sai com a conta).
   */
  upcoming(): string[];
  /** chamar_atendente: o roteiro acabou (o pedido de atendente encerra no banco). */
  stop(): void;
}

const runView = (run: ActiveRun) => ({ name: run.routine.name, steps: run.routine.steps, stepId: run.stepId, variables: run.variables, failing: run.failing });

/** O roteiro espera a pessoa escolher a conta (parte 2c). */
const heldPrompt = (name: string, note: string | null) =>
  [
    `ROTEIRO EM ANDAMENTO: "${name}", esperando a pessoa escolher a conta.`,
    "Os botões com as contas vão sozinhos: peça para ela escolher sobre qual conta é o atendimento, sem escrever a lista. Não siga para o próximo passo nem cite dados de nenhuma conta antes da escolha.",
    note ? `Nesta mensagem: ${note}` : "",
  ]
    .filter(Boolean)
    .join("\n");

/**
 * As ferramentas e o bloco do roteiro nesta vez (null se o bot não tem roteiro ligado). As quatro
 * ferramentas entram sempre juntas (lista estável, bom para o cache do provedor); fora do estado
 * certo, devolvem a instrução do que fazer.
 */
export function routineSession(
  db: SupabaseClient,
  i: { bot: { id: string }; conversationId: string; waPhone: string | null; turn: RoutineTurn; texts: string[]; requestHandoff: (reason: string) => Promise<string>; identity?: RoutineIdentityPort | null },
): RoutineSession | null {
  const available = i.turn.available;
  if (!available.length) return null;
  let run = i.turn.run;
  // o que aconteceu antes da IA (o BoaVoz já resolveu) e na preparação (ação indisponível)
  const notes: string[] = i.turn.note ? [i.turn.note] : [];
  const identified = () => Boolean(i.identity?.identified());

  const after = async (moved: Moved, lead: string): Promise<Record<string, unknown>> => {
    if (moved.kind === "completed") {
      run = null;
      return { ok: true, roteiro: "concluido", instrucao: `${lead} O roteiro terminou: siga a conversa normalmente.` };
    }
    if (moved.kind === "handoff") {
      run = null;
      const aviso = await i.requestHandoff(moved.reason);
      return { ok: true, roteiro: "equipe", aviso, instrucao: `${lead} O roteiro passou a conversa para a equipe: diga isso usando o aviso, sem prometer prazo.` };
    }
    const r = run!;
    const step = currentStep(r);
    const idx = r.routine.steps.indexOf(step);
    return { ok: true, passo: `${idx + 1} de ${r.routine.steps.length}`, instrucao: `${lead} Agora siga este passo: ${stepInstruction(step, { failing: r.failing })}`, ...(Object.keys(r.variables).length ? { dados: variablesLine(r.variables) } : {}) };
  };
  const noRun = { ok: false, instrucao: "Não há roteiro em andamento: responda normalmente." };
  const names = available.map((r) => r.name) as [string, ...string[]];
  const list = available.map((r) => `${r.name} (quando: ${r.when_to_use.slice(0, 200)})`).join("; ");

  const tools: Record<string, Tool> = {
    iniciar_roteiro: tool({
      description: `Começa um roteiro (os passos que a empresa definiu) quando a conversa entra no assunto dele. Roteiros: ${list}. Chame assim que reconhecer o assunto, antes de responder, e siga o passo que a ferramenta devolver. Não chame com um roteiro já em andamento.`,
      inputSchema: z.object({ nome: z.enum(names).describe("o nome exato do roteiro") }),
      execute: async ({ nome }) => {
        if (run) return { ok: false, instrucao: "Já há um roteiro em andamento: siga o passo atual." };
        const routine = available.find((r) => r.name === nome);
        if (!routine) return noRun;
        const started = await startRun(db, { botId: i.bot.id, conversationId: i.conversationId, routine, by: "ia", texts: i.texts, waPhone: i.waPhone, identified: identified() });
        run = started.run;
        return after(started.moved, `Roteiro "${routine.name}" começou.`);
      },
    }),
    concluir_passo: tool({
      description: "Roteiro em andamento: o passo atual (uma instrução) foi cumprido. Se o passo pede uma resposta da pessoa, chame só depois que ela respondeu. Devolve o próximo passo.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!run) return noRun;
        const step = currentStep(run);
        if (step.type === "dado") return { ok: false, instrucao: "Este passo só anda quando o dado for conferido: peça o dado." };
        if (step.type === "botoes") return { ok: false, instrucao: "Este passo só anda quando a pessoa tocar num botão ou responder com uma das opções." };
        if (step.type === "acao") return { ok: false, instrucao: run.heldResult ? "O roteiro espera a pessoa escolher a conta pelos botões." : "Este passo só anda depois da ação." };
        return after(await moveTo(db, run, nextFrom(run.routine.steps, step.id, step.next), { texts: i.texts, waPhone: i.waPhone, why: `Roteiro "${run.routine.name}"`, identified: identified() }), "Passo concluído.");
      },
    }),
    informar_dado: tool({
      description: "Roteiro em andamento, num passo que pede uma data ou um código: informa o valor que a pessoa escreveu (data em dd/mm/aaaa). O BoaVoz confere e devolve o próximo passo.",
      inputSchema: z.object({ valor: z.string().min(1).describe("o valor que a pessoa informou") }),
      execute: async ({ valor }) => {
        if (!run) return noRun;
        const step = currentStep(run);
        if (step.type !== "dado") return { ok: false, instrucao: "O passo atual não pede um dado." };
        if (FIXED_KINDS.has(step.kind)) return { ok: false, instrucao: `O ${label(step.kind)} o BoaVoz confere sozinho na mensagem da pessoa: só peça para ela mandar.` };
        const value = validateValue(step.kind, valor, step.pattern);
        if (!value) {
          const attempts = run.attempts + 1;
          const failing = attempts >= MAX_ATTEMPTS;
          await saveRun(db, run, { attempts, failing });
          return { ok: false, instrucao: failing ? stepInstruction(step, { failing: true }) : `Esse valor não confere com o que o passo pede. Peça de novo com gentileza (tentativa ${attempts} de ${MAX_ATTEMPTS}).` };
        }
        run.variables = { ...run.variables, [step.variable]: { kind: step.kind, value } };
        return after(await moveTo(db, run, nextFrom(run.routine.steps, step.id, step.next), { texts: i.texts, waPhone: i.waPhone, why: `Roteiro "${run.routine.name}"`, identified: identified() }), `Dado conferido: ${value}.`);
      },
    }),
    cancelar_roteiro: tool({
      description: 'Roteiro em andamento: a pessoa quer parar ("esquece", "não quero mais", "cancela"). Encerra o roteiro.',
      inputSchema: z.object({}),
      execute: async () => {
        if (!run) return noRun;
        await finishRun(db, run.id, "abandoned", "cancelled");
        run = null;
        return { ok: true, instrucao: "Roteiro cancelado. Diga que tudo bem e pergunte se pode ajudar em outra coisa." };
      },
    }),
  };

  return {
    tools,
    prepare: async (offered, o = {}) => {
      if (!run || o.confirmRound || run.heldResult) return;
      const step = currentStep(run);
      if (step.type !== "acao" || offered.has(`acao_${step.action}`)) return;
      const name = run.routine.name;
      const moved = await moveTo(db, run, nextFrom(run.routine.steps, step.id, resultDestination(step, "erro")), { texts: [], waPhone: i.waPhone, why: `Roteiro "${name}": a ação ${step.action} não está disponível`, endReason: "step_unavailable", identified: identified() });
      if (moved.kind === "handoff") {
        run = null;
        notes.push(`A consulta do roteiro "${name}" não está disponível agora e a conversa foi passada para a equipe. Diga isso à pessoa usando este aviso: ${await i.requestHandoff(moved.reason)}`);
      } else if (moved.kind === "completed") {
        run = null;
        notes.push(`A consulta do roteiro "${name}" não está disponível agora e o roteiro terminou: diga que não conseguiu consultar e siga a conversa.`);
      } else notes.push("A consulta do passo anterior não está disponível agora: siga o passo atual.");
    },
    actionStep: () => {
      if (!run || run.heldResult) return null;
      const step = currentStep(run);
      return step.type === "acao" ? { action: step.action, variables: run.variables } : null;
    },
    onActionResult: async (action, r, declared) => {
      if (!run || run.heldResult) return null;
      const step = currentStep(run);
      if (step.type !== "acao" || step.action !== action) return null;
      // 5 "não encontrado" em 1 hora tiram a ação do contato: é a ação que deixou de ser oferecida
      const unavailable = r.status === "unavailable";
      const key = unavailable ? "erro" : resultKey(r, declared);
      // identificação (parte 2c): a ação disse quem é a pessoa; com mais de uma conta, o roteiro
      // espera a escolha (os botões vão sozinhos) e segue por este resultado depois dela
      let lead = `Resultado da ação no roteiro: ${key}.`;
      if (r.status === "ok" && r.identity && i.identity) {
        const applied = await i.identity.apply(r.identity);
        if (applied?.choosing) {
          await saveRun(db, run, { heldResult: key });
          return {
            ok: true,
            identificacao: "escolher_conta",
            instrucao: `A pessoa foi identificada${applied.name ? ` (${applied.name})` : ""} e tem ${applied.accounts} contas. Peça para ela escolher sobre qual conta é o atendimento: os botões com as contas vão sozinhos (não escreva a lista). Não siga o roteiro nem cite dados de nenhuma conta antes da escolha.`,
          };
        }
        if (applied) lead = `${lead} A pessoa foi identificada${applied.name ? ` (${applied.name})` : ""}: as próximas consultas já vão com a conta dela.`;
      }
      const moved = await moveTo(db, run, nextFrom(run.routine.steps, step.id, resultDestination(step, key)), { texts: i.texts, waPhone: i.waPhone, why: `Roteiro "${run.routine.name}": ${action} (${key})`, identified: identified(), ...(unavailable ? { endReason: "step_unavailable" as const } : {}) });
      return after(moved, lead);
    },
    prompt: () => {
      const note = notes.join(" ") || null;
      if (run?.heldResult) return heldPrompt(run.routine.name, note);
      return run ? routinePrompt(runView(run), note) : note ? `Roteiro: ${note}` : null;
    },
    component: () => {
      if (!run) return null;
      if (run.heldResult) return i.identity?.accountButtons() ?? null;
      if (run.failing) return failButtons(run.id);
      const step = currentStep(run);
      return step.type === "botoes" ? stepButtons(run.id, step) : null;
    },
    blocksOptions: () => Boolean(run && (run.heldResult || run.failing || currentStep(run).type === "botoes")),
    upcoming: () => {
      if (!run || run.heldResult) return [];
      const step = currentStep(run);
      if (step.type !== "acao") return [];
      return [...new Set(run.routine.steps.flatMap((x) => (x.type === "acao" && x.id !== step.id ? [x.action] : [])))];
    },
    stop: () => {
      run = null;
    },
  };
}
