import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";
import { Logo } from "@/components/logo";

export const metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-16">
      <Logo />
      <Suspense>
        <AuthForm mode="login" />
      </Suspense>
    </main>
  );
}
