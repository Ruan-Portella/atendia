import { after } from "next/server";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAccess, requestIp } from "@/lib/access-log";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  await supabase.auth.signOut();
  const userId = data?.claims?.sub;
  if (userId) after(() => logAccess(createAdminClient(), { actorType: "user", actorId: String(userId), event: "logout", ip: requestIp(request.headers), userAgent: request.headers.get("user-agent") }));
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
