import { createBrowserClient } from "@supabase/ssr";
import { SESSION_COOKIE_OPTIONS } from "./cookie-options";

/** Cliente Supabase para Client Components (login, upload de logo). */
export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookieOptions: SESSION_COOKIE_OPTIONS });
}
