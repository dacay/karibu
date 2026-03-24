"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Flag, CheckCircle2, XCircle, BookOpen, MessageSquare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type FlaggedMessage } from "@/lib/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractTextFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p: unknown) => (p as { type: string }).type === "text")
    .map((p: unknown) => (p as { type: string; text: string }).text)
    .join("");
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const STATUS_LABELS: Record<FlaggedMessage["status"], string> = {
  open: "Open",
  reviewed: "Reviewed",
  dismissed: "Dismissed",
};

const STATUS_COLORS: Record<FlaggedMessage["status"], string> = {
  open: "bg-destructive/10 text-destructive border-destructive/30",
  reviewed: "bg-green-500/10 text-green-700 border-green-500/30",
  dismissed: "bg-muted text-muted-foreground border-border",
};

// ─── Filter tabs ──────────────────────────────────────────────────────────────

type FilterTab = "open" | "reviewed" | "dismissed" | "all";

const TABS: { id: FilterTab; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "reviewed", label: "Reviewed" },
  { id: "dismissed", label: "Dismissed" },
  { id: "all", label: "All" },
];

// ─── Single flag card ─────────────────────────────────────────────────────────

function FlagCard({ flag }: { flag: FlaggedMessage }) {
  const qc = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: (status: "reviewed" | "dismissed") =>
      api.flags.updateStatus(flag.id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["flags"] });
    },
  });

  const messageText = extractTextFromParts(flag.message.parts);

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {flag.chat.type === "microlearning" ? (
            <BookOpen className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate text-xs font-medium text-muted-foreground">
            {flag.chat.type === "microlearning"
              ? flag.chat.microlearningTitle ?? "Microlearning"
              : "Assistant chat"}
          </span>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[flag.status]}`}
        >
          {STATUS_LABELS[flag.status]}
        </span>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Message bubble */}
        <div className="rounded-lg bg-muted px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
          {messageText || <span className="italic text-muted-foreground">No text content</span>}
        </div>

        {/* Metadata */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            Flagged by <span className="font-medium text-foreground">{flag.flaggedByEmail}</span>
          </span>
          <span>{relativeTime(flag.createdAt)}</span>
          {flag.reason && (
            <span className="italic">"{flag.reason}"</span>
          )}
        </div>

        {/* Actions */}
        {flag.status === "open" && (
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => updateMutation.mutate("reviewed")}
              disabled={updateMutation.isPending}
              className="flex items-center gap-1.5 rounded-md border border-green-500/40 bg-green-500/10 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-500/20 disabled:opacity-50 transition-colors"
            >
              <CheckCircle2 className="size-3.5" />
              Mark reviewed
            </button>
            <button
              onClick={() => updateMutation.mutate("dismissed")}
              disabled={updateMutation.isPending}
              className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50 transition-colors"
            >
              <XCircle className="size-3.5" />
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function FlaggedMessagesSection() {
  const [activeTab, setActiveTab] = useState<FilterTab>("open");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["flags"],
    queryFn: api.flags.list,
  });

  const flags = data?.flags ?? [];
  const filtered =
    activeTab === "all" ? flags : flags.filter((f) => f.status === activeTab);

  const openCount = flags.filter((f) => f.status === "open").length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Flag className="size-5" />
          Flagged Messages
          {openCount > 0 && (
            <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-bold text-destructive-foreground">
              {openCount}
            </span>
          )}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Messages that learners have flagged as potentially inaccurate.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={[
              "px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
              activeTab === tab.id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {tab.label}
            {tab.id === "open" && openCount > 0 && (
              <span className="ml-1.5 rounded-full bg-destructive/15 px-1.5 py-0.5 text-xs font-semibold text-destructive">
                {openCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-48" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-3 w-40" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {isError && (
        <Card>
          <CardContent className="flex items-center justify-center h-32">
            <p className="text-sm text-muted-foreground">
              Failed to load flagged messages. Please try refreshing.
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && filtered.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center h-32 gap-2">
            <Flag className="size-6 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {activeTab === "open"
                ? "No open flags — all clear!"
                : `No ${activeTab} flags.`}
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && filtered.length > 0 && (
        <div className="space-y-4">
          {filtered.map((flag) => (
            <FlagCard key={flag.id} flag={flag} />
          ))}
        </div>
      )}
    </div>
  );
}
