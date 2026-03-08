"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Sun, Moon, Monitor, ChevronDown,
  BookOpen, CheckCircle2, Clock, MessageCircle, ChevronRight,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import { api, getApiBaseUrl, getToken, INACTIVITY_WINDOW_MS, type LearnerFeedML } from "@/lib/api";

const APPEARANCE_OPTIONS: { value: string; label: string; icon: React.ElementType }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

function getInitials(email: string): string {
  const [local] = email.split("@");
  const parts = local.split(/[._-]/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

// ─── Active ML card ─────────────────────────────────────────────────────────

function ActiveMLCard({ ml }: { ml: LearnerFeedML }) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const isInProgress = ml.progress?.status === "active";
  const isCompleted = ml.progress?.status === "completed";
  const isSequence = !!ml.sequenceName;
  const isNew = isSequence && ml.progress === null;
  const glowColor = resolvedTheme === "dark"
    ? "rgba(34, 197, 94, 0.45)"
    : "rgba(22, 163, 74, 0.35)";

  return (
    <button
      type="button"
      onClick={() => router.push(`/ml/${ml.id}`)}
      className="flex items-center gap-4 rounded-lg border p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring w-full"
      style={isNew ? { boxShadow: `0 0 10px 2px ${glowColor}` } : undefined}
    >
      <div className="flex-1 min-w-0">
        {ml.sequenceName && (
          <p className="text-xs text-muted-foreground mb-0.5 truncate">{ml.sequenceName}</p>
        )}
        <p className="text-sm font-medium truncate">{ml.title}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isCompleted && (
          <CheckCircle2 className="size-4 text-green-500" />
        )}
        {isInProgress && (
          <Badge variant="outline" className="gap-1 text-xs">
            In progress
          </Badge>
        )}
        <ChevronRight className="size-4 text-muted-foreground" />
      </div>
    </button>
  );
}

// ─── Archive ML card ─────────────────────────────────────────────────────────

function ArchiveMLCard({ ml }: { ml: LearnerFeedML }) {
  const router = useRouter();
  const isCompleted = ml.progress?.status === "completed";

  return (
    <button
      type="button"
      onClick={() => router.push(`/ml/${ml.id}`)}
      className="flex items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring w-full"
    >
      <div className="flex-1 min-w-0">
        {ml.sequenceName && (
          <p className="text-xs text-muted-foreground truncate">{ml.sequenceName}</p>
        )}
        <p className="text-sm text-muted-foreground truncate">{ml.title}</p>
      </div>
      {isCompleted ? (
        <Badge variant="outline" className="gap-1 border-green-500 text-green-600 shrink-0 text-xs">
          <CheckCircle2 className="size-3" />
          Done
        </Badge>
      ) : (
        <Badge variant="outline" className="gap-1 shrink-0 text-xs text-muted-foreground">
          <Clock className="size-3" />
          Expired
        </Badge>
      )}
    </button>
  );
}

// ─── Ask me anything card ────────────────────────────────────────────────────

function AskMeAnythingCard() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.push("/chat")}
      className="flex items-center gap-4 rounded-lg border border-dashed bg-muted/40 p-4 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring w-full"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">Ask me anything</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Have a question? Start a free conversation.
        </p>
      </div>
      <MessageCircle className="size-4 text-blue-500 shrink-0" />
    </button>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function LearnerRoot() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();

  const initials = user?.email ? getInitials(user.email) : "?";

  const { data: feedData, isLoading: feedLoading } = useQuery({
    queryKey: ["learner", "feed"],
    queryFn: api.learner.feed,
    enabled: !!user,
  });

  const { data: profileData } = useQuery({
    queryKey: ["user", "me"],
    queryFn: api.user.me,
    enabled: !!user,
  });

  const { data: avatarsData } = useQuery({
    queryKey: ["avatars"],
    queryFn: api.avatars.list,
    enabled: !!user,
  });

  const updatePreferenceMutation = useMutation({
    mutationFn: (preferredAvatarId: string | null) =>
      api.user.updatePreferences({ preferredAvatarId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user", "me"] });
    },
  });

  // ── SSE: refetch feed when admin publishes ML or assigns sequence ────────────
  useEffect(() => {
    const token = getToken();
    if (!token) return;

    const es = new EventSource(
      `${getApiBaseUrl()}/learner/stream?token=${encodeURIComponent(token)}`
    );

    es.addEventListener("feed:updated", () => {
      queryClient.invalidateQueries({ queryKey: ["learner", "feed"] });
    });

    return () => es.close();
  }, [queryClient]);

  // ── Expiry timers: auto-refetch when an active ML's window closes ────────────
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (const ml of feedData?.active ?? []) {
      if (ml.progress?.status === "active" && ml.progress.openedAt) {
        const expiresAt =
          new Date(ml.progress.openedAt).getTime() + INACTIVITY_WINDOW_MS;
        const delay = expiresAt - Date.now();
        if (delay > 0) {
          timers.push(
            setTimeout(() => {
              queryClient.invalidateQueries({ queryKey: ["learner", "feed"] });
            }, delay)
          );
        }
      }
    }

    return () => timers.forEach(clearTimeout);
  }, [feedData, queryClient]);

  const active = feedData?.active ?? [];
  const archive = feedData?.archive ?? [];
  const isEmpty = !feedLoading && active.length === 0 && archive.length === 0;

  return (
    <div className="flex min-h-screen flex-col">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex h-16 items-center justify-between border-b px-6">
        <span className="text-lg font-semibold">Karibu</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 h-9 px-2">
              <Avatar className="size-7">
                <AvatarFallback className="text-xs">{initials}</AvatarFallback>
              </Avatar>
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-medium">My Account</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            {avatarsData?.avatars && avatarsData.avatars.length > 0 && (
              <>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="cursor-pointer">
                    <span>Chat Avatar</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="w-52">
                      <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                        Override the default avatar
                      </DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={profileData?.user.preferredAvatarId ?? "default"}
                        onValueChange={(val) =>
                          updatePreferenceMutation.mutate(val === "default" ? null : val)
                        }
                      >
                        <DropdownMenuRadioItem value="default" className="cursor-pointer">
                          Use default
                        </DropdownMenuRadioItem>
                        {avatarsData.avatars.map((a) => (
                          <DropdownMenuRadioItem key={a.id} value={a.id} className="cursor-pointer">
                            {a.name}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
              </>
            )}

            <DropdownMenuLabel className="text-xs text-muted-foreground font-normal px-2 py-1">
              Appearance
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
              {APPEARANCE_OPTIONS.map(({ value, label, icon: Icon }) => (
                <DropdownMenuRadioItem key={value} value={value} className="cursor-pointer">
                  <Icon className="size-3.5 mr-2" />
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer text-destructive focus:text-destructive"
              onClick={logout}
            >
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────────── */}
      <main className="flex-1 p-6">
        <h2 className="mb-1 text-xl font-semibold">My Learning</h2>
        <p className="mb-6 text-sm text-muted-foreground">
          Your assigned microlearning sessions
        </p>

        {feedLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner className="size-6" />
          </div>
        ) : isEmpty ? (
          /* ── Empty state ──────────────────────────────────────────────── */
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center max-w-2xl">
            <BookOpen className="size-8 text-muted-foreground mb-3" />
            <p className="text-sm font-medium">No microlearnings assigned</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Your administrator will assign learning content here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-8 max-w-2xl">
            {/* ── Active MLs + Ask me anything ──────────────────────────── */}
            {(active.length > 0) && (
              <div className="flex flex-col gap-4">
                {active.map((ml) => (
                  <ActiveMLCard key={ml.id} ml={ml} />
                ))}
              </div>
            )}

            <AskMeAnythingCard />

            {/* ── Archive ────────────────────────────────────────────────── */}
            {archive.length > 0 && (
              <>
                <Separator />
                <Accordion type="single" collapsible className="-mt-4">
                  <AccordionItem value="archive" className="border-none">
                    <AccordionTrigger className="py-2 text-sm text-muted-foreground hover:no-underline hover:text-foreground">
                      <span>Archive&nbsp;<span className="text-xs font-normal">({archive.length})</span></span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="flex flex-col gap-1 pt-1">
                        {archive.map((ml) => (
                          <ArchiveMLCard key={ml.id} ml={ml} />
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
