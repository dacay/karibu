"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/hooks/useAuth";
import { useLogo } from "@/hooks/useLogo";
import { useOrgPublic, accessIdLabel } from "@/hooks/useOrgPublic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

/**
 * ID-only sign-in page for organizations running access mode: a learner enters
 * the ID their organization issued them (e.g. a UCSF ID) and nothing else.
 * The page does not exist for other organizations — they are sent to /login,
 * and the backend rejects ID logins for them regardless.
 */
export default function AccessPage() {
  const { accessLogin } = useAuth();
  const { org, isLoading: orgLoading } = useOrgPublic();
  const { lightSrc, darkSrc, isLoading: logoLoading } = useLogo();
  const router = useRouter();
  const [externalId, setExternalId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const enabled = org?.accessModeEnabled ?? false;
  const label = accessIdLabel(org);
  const sessionHours = org?.accessSessionHours ?? 12;

  useEffect(() => {
    if (!orgLoading && !enabled) {
      router.replace("/login");
    }
  }, [orgLoading, enabled, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsPending(true);
    try {
      await accessLogin(externalId.trim());
      router.replace("/");
    } catch {
      setError(`We could not find that ${label}. Check it and try again.`);
      setIsPending(false);
    }
  }

  if (orgLoading || !enabled) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="size-8" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-sm">
        <CardContent className="px-8 pt-8 pb-8">
          <div className="mb-6 flex justify-center">
            <div className="relative w-36 h-14">
              {!logoLoading && (
                <>
                  <Image
                    src={lightSrc}
                    alt="Logo"
                    fill
                    className="block dark:hidden object-contain"
                    unoptimized
                    priority
                  />
                  <Image
                    src={darkSrc}
                    alt="Logo"
                    fill
                    className="hidden dark:block object-contain"
                    unoptimized
                    priority
                  />
                </>
              )}
            </div>
          </div>

          <div className="mb-5 text-center">
            <h1 className="text-xl font-semibold tracking-tight">Get started</h1>
            <p className="mt-1 text-sm text-muted-foreground">Enter your {label} to continue</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="externalId">{label}</Label>
              <Input
                id="externalId"
                type="text"
                required
                autoFocus
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" disabled={isPending || !externalId.trim()} className="w-full">
              {isPending && <Spinner className="mr-2" />}
              {isPending ? "Signing in…" : "Continue"}
            </Button>
          </form>

          <p className="mt-5 text-center text-xs text-muted-foreground">
            You will stay signed in on this device for {sessionHours} hours.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
