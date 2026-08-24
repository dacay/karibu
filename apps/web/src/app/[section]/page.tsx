"use client";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { getSignInPath } from "@/lib/api";
import { AdminRoot } from "@/features/admin";
import { LearnerRoot } from "@/features/learner";
import { Spinner } from "@/components/ui/spinner";
import { AVATARS_ENABLED } from "@/lib/features";

const ADMIN_ONLY_SECTIONS = new Set(["source", "microlearnings", "avatars", "patterns", "team", "flagged", "reports"]);

export default function SectionPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const { section } = useParams<{ section: string }>();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace(getSignInPath());
    } else if (!AVATARS_ENABLED && section === "avatars") {
      router.replace("/");
    } else if (user.role === "user" && ADMIN_ONLY_SECTIONS.has(section)) {
      router.replace("/");
    }
  }, [user, isLoading, router, section]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (!user) return null;

  return user.role === "admin" ? <AdminRoot /> : <LearnerRoot />;
}
