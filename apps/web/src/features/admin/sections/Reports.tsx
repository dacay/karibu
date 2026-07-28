"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Download, Eye } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type ReportFile } from "@/lib/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Formats a plain YYYY-MM-DD. Parsed part-by-part so the day is read as a
// calendar date rather than a UTC instant that can shift a day in local time.
function formatDateHeading(date: string): string {
  const [year, month, day] = date.split("-").map(Number);

  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function isPdf(name: string): boolean {
  return name.toLowerCase().endsWith(".pdf");
}

// Display only — the extension stays on `name` for isPdf() and for the
// server-side description matching, and on the downloaded file itself.
function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

// Group reports by their report date (filename-derived, else upload date), newest first.
interface ReportGroup {
  dateKey: string;
  label: string;
  reports: ReportFile[];
}

function groupByDate(reports: ReportFile[]): ReportGroup[] {
  const groups = new Map<string, ReportFile[]>();

  for (const report of reports) {
    const existing = groups.get(report.date);
    if (existing) {
      existing.push(report);
    } else {
      groups.set(report.date, [report]);
    }
  }

  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([dateKey, groupReports]) => ({
      dateKey,
      label: formatDateHeading(dateKey),
      reports: groupReports,
    }));
}

// ─── Single report row ──────────────────────────────────────────────────────────

function ReportRow({ report }: { report: ReportFile }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-card px-4 py-3 shadow-sm">
      <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {stripExtension(report.name)}
        </p>
        {report.description && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {report.description}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 -mt-0.5">
        {isPdf(report.name) && (
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <a href={report.viewUrl} target="_blank" rel="noopener noreferrer">
              <Eye className="size-3.5" />
              View
            </a>
          </Button>
        )}
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <a href={report.downloadUrl}>
            <Download className="size-3.5" />
            Download
          </a>
        </Button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ReportsSection() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["reports", "list"],
    queryFn: api.reports.list,
  });

  const reports = useMemo(() => data?.reports ?? [], [data]);
  const configured = data?.configured ?? true;
  const groups = useMemo(() => groupByDate(reports), [reports]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <FileText className="size-5" />
          Reports
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Report files available for viewing and download, grouped by date.
        </p>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {isError && (
        <Card>
          <CardContent className="flex items-center justify-center h-32">
            <p className="text-sm text-muted-foreground">
              Failed to load reports. Please try refreshing.
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && !configured && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center h-32 gap-2">
            <FileText className="size-6 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Report storage is not configured yet.
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && configured && reports.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center h-32 gap-2">
            <FileText className="size-6 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No reports available yet.</p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && groups.length > 0 && (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.dateKey} className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground">{group.label}</h3>
              <div className="space-y-2">
                {group.reports.map((report) => (
                  <ReportRow key={report.key} report={report} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
