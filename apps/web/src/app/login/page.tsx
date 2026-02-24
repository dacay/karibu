"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/hooks/useAuth";
import { useLogo } from "@/hooks/useLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

export default function LoginPage() {
  const { login } = useAuth();
  const { lightSrc, darkSrc, isLoading, onLightError, onDarkError } = useLogo();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsPending(true);
    try {
      await login({ email: email.trim(), password: password.trim() });
      router.replace("/");
    } catch (err) {
      setError("Invalid email or password.");
      setIsPending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-sm">
        <CardContent className="px-8 pt-8 pb-8">
          <div className="mb-6 flex justify-center min-h-[40px] items-center">
            {isLoading ? (
              <Spinner />
            ) : (
              <>
                <Image
                  src={lightSrc}
                  alt="Logo"
                  width={120}
                  height={40}
                  className="block dark:hidden"
                  onError={onLightError}
                  priority
                />
                <Image
                  src={darkSrc}
                  alt="Logo"
                  width={120}
                  height={40}
                  className="hidden dark:block"
                  onError={onDarkError}
                  priority
                />
              </>
            )}
          </div>

          <div className="mb-5 text-center">
            <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
            <p className="mt-1 text-sm text-muted-foreground">For organization administrators only</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" disabled={isPending} className="w-full">
              {isPending && <Spinner className="mr-2" />}
              {isPending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
