"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/providers/auth-provider";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      await login(email, password);
      toast.success("Signed in successfully");
      router.replace("/");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login failed";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F5F6F8] px-4 py-10 text-[#323338]">
      <section className="w-full max-w-md rounded-lg border border-[#D0D4E4] bg-white p-8 shadow-monday-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#676879]">Builder&apos;s Ledger</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-[#323338]">Sign In</h1>
        <p className="mt-1 text-sm text-[#676879]">Use your Firebase Auth account to access jobs and invoices.</p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="mb-1 block text-sm font-semibold text-[#323338]" htmlFor="login-email">
              Email
            </label>
            <Input
              id="login-email"
              type="email"
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
              className="h-11 text-base"
              placeholder="you@company.com"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-[#323338]" htmlFor="login-password">
              Password
            </label>
            <Input
              id="login-password"
              type="password"
              required
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
              className="h-11 text-base"
              placeholder="••••••••"
            />
          </div>

          <Button className="mt-2 h-11 w-full text-base font-semibold" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Signing In..." : "Sign In"}
          </Button>
        </form>
      </section>
    </main>
  );
}
