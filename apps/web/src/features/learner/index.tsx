"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen, CheckCircle2, Clock, MessageCircle, ChevronRight,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";

import { useAuth } from "@/hooks/useAuth";
import { useLogo } from "@/hooks/useLogo";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AccountMenu } from "@/components/AccountMenu";
import { KaribuFooter } from "@/components/KaribuFooter";
import { getAssetUrl } from "@/lib/assets";
import { api, getApiBaseUrl, getToken, DEFAULT_INACTIVITY_WINDOW_MS, type LearnerFeedML } from "@/lib/api";

// ─── Active ML card ─────────────────────────────────────────────────────────

function ActiveMLCard({ ml }: { ml: LearnerFeedML }) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const isInProgress = ml.progress?.status === "active";
  const isCompleted = ml.progress?.status === "completed";
  const isSequence = !!ml.sequenceName;
  const isNew = isSequence && ml.progress === null;
  const imageUrl = ml.imageS3Key ? getAssetUrl(ml.imageS3Key) : null;

  const glowColor = resolvedTheme === "dark"
    ? "rgba(34, 197, 94, 0.45)"
    : "rgba(22, 163, 74, 0.35)";

  return (
    <button
      type="button"
      onClick={() => router.push(`/ml/${ml.id}`)}
      className="group relative flex flex-col justify-end overflow-hidden rounded-2xl border bg-card text-left transition-all hover:scale-[1.02] hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring w-full cursor-pointer"
      style={{
        aspectRatio: "3/4",
        ...(isNew ? { boxShadow: `0 0 14px 3px ${glowColor}` } : {}),
      }}
    >
      {/* Full-bleed background image */}
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt=""
          fill
          className="object-cover transition-transform duration-300 group-hover:scale-105"
          unoptimized
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-muted to-muted-foreground/20" />
      )}

      {/* Status badges — top-right */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5">
        {isCompleted && (
          <Badge className="gap-1 bg-green-600/90 text-white border-0 text-xs backdrop-blur-sm">
            <CheckCircle2 className="size-3" />
            Completed
          </Badge>
        )}
        {isInProgress && (
          <Badge className="gap-1 bg-black/40 text-white border-0 text-xs backdrop-blur-sm">
            In progress
          </Badge>
        )}
      </div>

      {/* Fading blur — covers bottom half, fades into image above */}
      <div
        className="absolute inset-x-0 bottom-0 h-[52%] backdrop-blur-xl"
        style={{ maskImage: "linear-gradient(to top, black 20%, transparent 80%)" }}
      />
      {/* Dark gradient overlay for text legibility */}
      <div className="absolute inset-x-0 bottom-0 h-[52%] bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

      {/* Content overlaid on gradient */}
      <div className="relative z-10 flex flex-col gap-2 p-4">
        {/* Title */}
        <h3 className="text-base font-semibold leading-snug line-clamp-2 text-white">
          {ml.title}
        </h3>

        {/* Topic · Sequence — secondary context */}
        {(ml.topics.length > 0 || ml.sequenceName) && (
          <p className="text-xs text-white/60 truncate">
            {[ml.topics.map((t) => t.name).join(", ") || null, ml.sequenceName].filter(Boolean).join(" · ")}
          </p>
        )}

        {/* CTA button */}
        <div
          className={`mt-1 w-full rounded-full py-2.5 text-center text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 ${
            isCompleted
              ? "bg-white/20 text-white backdrop-blur-sm hover:bg-white/30"
              : "bg-white text-black hover:bg-white/90"
          }`}
        >
          {isCompleted && <CheckCircle2 className="size-3.5" />}
          {isCompleted ? "Review" : isInProgress ? "Continue" : "Start"}
        </div>
      </div>
    </button>
  );
}

// ─── Archive ML card ─────────────────────────────────────────────────────────

function ArchiveMLCard({ ml }: { ml: LearnerFeedML }) {
  const router = useRouter();
  const isCompleted = ml.progress?.status === "completed";
  const imageUrl = ml.imageS3Key ? getAssetUrl(ml.imageS3Key) : null;

  return (
    <button
      type="button"
      onClick={() => router.push(`/ml/${ml.id}`)}
      className="group relative flex flex-col justify-end overflow-hidden rounded-2xl border bg-card text-left transition-all hover:scale-[1.02] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring w-full cursor-pointer opacity-70 hover:opacity-100"
      style={{ aspectRatio: "3/4" }}
    >
      {/* Full-bleed background image */}
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt=""
          fill
          className="object-cover grayscale transition-all duration-300 group-hover:grayscale-0"
          unoptimized
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-muted to-muted-foreground/20" />
      )}

      {/* Fading blur */}
      <div
        className="absolute inset-x-0 bottom-0 h-[52%] backdrop-blur-xl"
        style={{ maskImage: "linear-gradient(to top, black 20%, transparent 80%)" }}
      />
      {/* Dark gradient overlay */}
      <div className="absolute inset-x-0 bottom-0 h-[52%] bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

      {/* Content */}
      <div className="relative z-10 flex flex-col gap-2 p-4">
        <h3 className="text-base font-semibold leading-snug line-clamp-2 text-white">{ml.title}</h3>
        {(ml.topics.length > 0 || ml.sequenceName) && (
          <p className="text-xs text-white/60 truncate">
            {[ml.topics.map((t) => t.name).join(", ") || null, ml.sequenceName].filter(Boolean).join(" · ")}
          </p>
        )}

        <div className="mt-1 w-full rounded-full py-2 text-center text-sm font-semibold flex items-center justify-center gap-1.5 bg-white/20 text-white backdrop-blur-sm">
          {isCompleted ? <CheckCircle2 className="size-3.5" /> : <Clock className="size-3.5" />}
          {isCompleted ? "Review" : "Expired"}
        </div>
      </div>
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
      className="group relative flex flex-col justify-end overflow-hidden rounded-2xl border border-dashed bg-card text-left transition-all hover:scale-[1.02] hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring w-full cursor-pointer"
      style={{ aspectRatio: "3/4" }}
    >
      {/* Tool background — solid dark gradient (no image) */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950" />

      {/* Centered tool icon in the upper portion */}
      <div className="absolute inset-x-0 top-0 bottom-[40%] flex items-center justify-center">
        <MessageCircle
          className="size-20 text-white/30 transition-transform duration-300 group-hover:scale-110"
          strokeWidth={1.5}
        />
      </div>

      {/* Fading blur to match ML cards */}
      <div
        className="absolute inset-x-0 bottom-0 h-[52%] backdrop-blur-xl"
        style={{ maskImage: "linear-gradient(to top, black 20%, transparent 80%)" }}
      />
      {/* Dark gradient overlay */}
      <div className="absolute inset-x-0 bottom-0 h-[52%] bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

      {/* Content */}
      <div className="relative z-10 flex flex-col gap-2 p-4">
        <h3 className="text-base font-semibold leading-snug line-clamp-2 text-white">
          Ask me anything
        </h3>
        <p className="text-xs text-white/60 truncate">
          Have a question? Start a free conversation.
        </p>
        <div className="mt-1 w-full rounded-full py-2.5 text-center text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 bg-white/20 text-white backdrop-blur-sm hover:bg-white/30">
          Ask anything
        </div>
      </div>
    </button>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function LearnerRoot() {
  const { user } = useAuth();
  const { lightSrc, darkSrc, isLoading: logoLoading } = useLogo();
  const queryClient = useQueryClient();

  const { data: feedData, isLoading: feedLoading } = useQuery({
    queryKey: ["learner", "feed"],
    queryFn: api.learner.feed,
    enabled: !!user,
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
          new Date(ml.progress.openedAt).getTime() + (feedData?.expirationIntervalMs ?? DEFAULT_INACTIVITY_WINDOW_MS);
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
        {!logoLoading && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="relative w-28 h-9">
                  <Image
                    src={lightSrc}
                    alt="Logo"
                    fill
                    className="block dark:hidden object-contain object-left"
                    unoptimized
                    priority
                  />
                  <Image
                    src={darkSrc}
                    alt="Logo"
                    fill
                    className="hidden dark:block object-contain object-left"
                    unoptimized
                    priority
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {user?.organizationName}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <AccountMenu />
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
          <div className="flex flex-col gap-6">
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
              <BookOpen className="size-8 text-muted-foreground mb-3" />
              <p className="text-sm font-medium">No microlearnings assigned</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Your administrator will assign learning content here.
              </p>
            </div>
            <div className="grid gap-6 grid-cols-1 sm:[grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
              <AskMeAnythingCard />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            {/* ── Active MLs + Ask me anything (last cell) ───────────────── */}
            <div className="grid gap-6 grid-cols-1 sm:[grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
              {active.map((ml) => (
                <ActiveMLCard key={ml.id} ml={ml} />
              ))}
              <AskMeAnythingCard />
            </div>

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
                      <div className="grid gap-6 pt-2 grid-cols-1 sm:[grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
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

      <KaribuFooter />
    </div>
  );
}
