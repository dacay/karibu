"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Users,
  Activity,
  CheckCircle2,
  RotateCcw,
  Clock,
  MessageSquare,
  TrendingUp,
  TrendingDown,
  Minus,
  Flag,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { api, type DashboardMetrics, type OrgConfig } from "@/lib/api";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(value: number | null, unit = "", fallback = "—"): string {
  if (value === null || value === undefined) return fallback;
  return `${value}${unit}`;
}

function fmtDuration(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
        <Minus className="size-3" />
        Same as last month
      </span>
    );
  }

  if (delta > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-green-600">
        <TrendingUp className="size-3" />
        +{delta} vs last month
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-red-500">
      <TrendingDown className="size-3" />
      {delta} vs last month
    </span>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function StatCardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-32" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-9 w-20 mb-1" />
        <Skeleton className="h-3 w-24" />
      </CardContent>
    </Card>
  );
}

function SectionSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </CardContent>
    </Card>
  );
}

// ─── Loaded view ─────────────────────────────────────────────────────────────

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function LoadedDashboard({ data, orgConfig }: { data: DashboardMetrics; orgConfig: OrgConfig | undefined }) {
  const {
    usageFrequency,
    sessionDuration,
    messagesPerDayPerNurse,
    returnVisits,
    completionMetrics,
    completionsThisMonth,
  } = data;

  const term = orgConfig?.learnerTerm ?? "user";
  const termPlural = orgConfig?.learnerTermPlural ?? "users";
  const Term = term.charAt(0).toUpperCase() + term.slice(1);

  // Top-20 rows for the learner message table
  const nurseTableRows = messagesPerDayPerNurse.slice(0, 20);

  // Sessions-per-day for the last 14 entries (already sorted desc from API)
  const sessionDays = usageFrequency.sessionsPerDay.slice(0, 14);

  return (
    <div className="space-y-6">
      {/* ── Top stat cards ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <Users className="size-4" />
              Unique Learners
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{usageFrequency.uniqueLearners}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {usageFrequency.totalSessions} total sessions
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <CheckCircle2 className="size-4" />
              Completions This Month
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{completionsThisMonth}</p>
            <p className="text-xs text-muted-foreground mt-0.5">microlearnings completed</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <Clock className="size-4" />
              Avg. Session Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{fmtDuration(sessionDuration.avgMinutes)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {sessionDuration.minMinutes !== null && sessionDuration.maxMinutes !== null
                ? `range: ${fmtDuration(sessionDuration.minMinutes)} – ${fmtDuration(sessionDuration.maxMinutes)}`
                : "no data yet"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <RotateCcw className="size-4" />
              Return Visit Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{returnVisits.percentOfLearners}%</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {returnVisits.total} of {returnVisits.totalLearners} {termPlural} returned
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Middle row: Duration + Completion + Return visits ────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* ii. Session duration */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="size-4" />
              Session Duration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              <MetricRow label="Average" value={fmtDuration(sessionDuration.avgMinutes)} />
              <MetricRow label="Shortest" value={fmtDuration(sessionDuration.minMinutes)} />
              <MetricRow label="Longest" value={fmtDuration(sessionDuration.maxMinutes)} />
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Time from first to last message per session.
            </p>
          </CardContent>
        </Card>

        {/* v. Time to complete a microlearning */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="size-4" />
              Time to Complete
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              By time (opened → completed)
            </p>
            <div className="divide-y mb-3">
              <MetricRow label="Average" value={fmtDuration(completionMetrics.avgMinutes)} />
              <MetricRow label="Fastest" value={fmtDuration(completionMetrics.minMinutes)} />
              <MetricRow label="Slowest" value={fmtDuration(completionMetrics.maxMinutes)} />
            </div>
            <Separator className="my-2" />
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              By messages exchanged
            </p>
            <div className="divide-y">
              <MetricRow label="Average" value={fmt(completionMetrics.avgMessages, " msgs")} />
              <MetricRow label="Fewest" value={fmt(completionMetrics.minMessages, " msgs")} />
              <MetricRow label="Most" value={fmt(completionMetrics.maxMessages, " msgs")} />
            </div>
          </CardContent>
        </Card>

        {/* iv. Return visits after completion */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <RotateCcw className="size-4" />
              Return Visits After Completion
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y mb-3">
              <MetricRow label={`Total ${termPlural}`} value={String(returnVisits.totalLearners)} />
              <MetricRow
                label="Returned with new question"
                value={`${returnVisits.total} (${returnVisits.percentOfLearners}%)`}
              />
              <MetricRow label="This month" value={String(returnVisits.thisMonthCount)} />
              <MetricRow label="Last month" value={String(returnVisits.lastMonthCount)} />
            </div>
            <DeltaBadge delta={returnVisits.deltaVsLastMonth} />
            {returnVisits.byMonth.length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Monthly trend
                </p>
                {returnVisits.byMonth.slice(-6).map((m) => (
                  <div key={m.month} className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{m.month}</span>
                    <span className="font-medium tabular-nums">{m.count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Bottom row: per-learner table + sessions per day ────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* iii. Messages per day per learner */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="size-4" />
              Messages Per Day Per {Term}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {nurseTableRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No message data yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="pb-2 font-medium">{Term}</th>
                      <th className="pb-2 font-medium">Date</th>
                      <th className="pb-2 font-medium text-right">Messages</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {nurseTableRows.map((row, i) => (
                      <tr key={`${row.userId}-${row.date}-${i}`}>
                        <td className="py-1.5 pr-3 truncate max-w-[140px] text-xs">
                          {row.email}
                        </td>
                        <td className="py-1.5 pr-3 text-xs text-muted-foreground">
                          {row.date}
                        </td>
                        <td className="py-1.5 text-right font-semibold tabular-nums">
                          {row.messageCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {messagesPerDayPerNurse.length > 20 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Showing 20 of {messagesPerDayPerNurse.length} rows (most recent first).
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* i. Sessions per day */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="size-4" />
              Sessions Per Day
            </CardTitle>
          </CardHeader>
          <CardContent>
            {sessionDays.length === 0 ? (
              <p className="text-sm text-muted-foreground">No session data yet.</p>
            ) : (
              <div className="space-y-1">
                {sessionDays.map((day) => {
                  const maxCount = Math.max(...sessionDays.map((d) => d.count), 1);
                  const pct = Math.round((day.count / maxCount) * 100);
                  return (
                    <div key={day.date} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-24 shrink-0">
                        {day.date}
                      </span>
                      <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs font-semibold tabular-nums w-6 text-right">
                        {day.count}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Flagged messages banner ──────────────────────────────────────────────────

function FlaggedMessagesBanner({
  count,
  onView,
}: {
  count: number;
  onView: () => void;
}) {
  if (count === 0) return null;

  return (
    <button
      onClick={onView}
      className="w-full text-left rounded-xl border-2 border-destructive/60 bg-destructive/5 px-5 py-4 shadow-[0_0_18px_2px_rgba(239,68,68,0.25)] animate-pulse-glow transition-shadow hover:shadow-[0_0_28px_4px_rgba(239,68,68,0.4)] focus:outline-none"
      style={{
        animation: "flagGlow 2.5s ease-in-out infinite",
      }}
    >
      <style>{`
        @keyframes flagGlow {
          0%, 100% { box-shadow: 0 0 14px 2px rgba(239,68,68,0.25); }
          50%       { box-shadow: 0 0 28px 6px rgba(239,68,68,0.50); }
        }
      `}</style>
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/15">
          <Flag className="size-4 text-destructive" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-destructive">
            {count} flagged message{count !== 1 ? "s" : ""} need{count === 1 ? "s" : ""} review
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Learners have flagged content as potentially inaccurate. Click to review.
          </p>
        </div>
        <span className="shrink-0 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive">
          View all
        </span>
      </div>
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DashboardSection({ onNavigateToFlags }: { onNavigateToFlags?: () => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["metrics"],
    queryFn: () => api.metrics.get(),
  });

  const { data: orgConfig } = useQuery({
    queryKey: ["org", "config"],
    queryFn: api.org.getConfig,
  });

  const { data: flagCount } = useQuery({
    queryKey: ["flags", "count"],
    queryFn: api.flags.count,
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Dashboard</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Overview of your organization's learning activity.
        </p>
      </div>

      {flagCount && flagCount.count > 0 && (
        <FlaggedMessagesBanner
          count={flagCount.count}
          onView={() => onNavigateToFlags?.()}
        />
      )}

      {isLoading && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <SectionSkeleton />
            <SectionSkeleton />
            <SectionSkeleton />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SectionSkeleton />
            <SectionSkeleton />
          </div>
        </div>
      )}

      {isError && (
        <Card>
          <CardContent className="flex items-center justify-center h-32">
            <p className="text-sm text-muted-foreground">
              Failed to load metrics. Please try refreshing the page.
            </p>
          </CardContent>
        </Card>
      )}

      {data && <LoadedDashboard data={data} orgConfig={orgConfig} />}
    </div>
  );
}
