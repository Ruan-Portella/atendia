import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Sessão encerrada por um dono ou administrador da equipe: sai deste navegador e volta para Entrar, com o aviso. */
export async function GET(request: Request) {
  await (await createClient()).auth.signOut({ scope: "local" });
  return NextResponse.redirect(new URL("/login?encerrada=1", request.url), { status: 303 });
}
