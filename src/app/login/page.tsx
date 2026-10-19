import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";
import { Logo } from "@/components/logo";
import { loginCodeEnabled } from "@/lib/login-code";

export const metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-16">
      <Logo />
      <Suspense>
        <AuthForm mode="login" emailEnabled={loginCodeEnabled()} />
      </Suspense>
    </main>
  );
}
