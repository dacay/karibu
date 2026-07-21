"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Download, Eye } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type ReportFile } from "@/lib/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateHeading(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function isPdf(name: string): boolean {
  return name.toLowerCase().endsWith(".pdf");
}

// Group reports by the calendar day of their lastModified timestamp, newest first.
interface ReportGroup {
  dateKey: string;
  label: string;
  reports: ReportFile[];
}

function groupByDate(reports: ReportFile[]): ReportGroup[] {
  const groups = new Map<string, ReportFile[]>();

  for (const report of reports) {
    const d = new Date(report.lastModified);
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const existing = groups.get(dateKey);
    if (existing) {
      existing.push(report);
    } else {
      groups.set(dateKey, [report]);
    }
  }

  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([dateKey, groupReports]) => ({
      dateKey,
      label: formatDateHeading(groupReports[0].lastModified),
      reports: groupReports,
    }));
}

// ─── Single report row ──────────────────────────────────────────────────────────

function ReportRow({ report }: { report: ReportFile }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-card px-4 py-3 shadow-sm">
      <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{report.name}</p>
        {report.description && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {report.description}
          </p>
        )}
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground/80">
          <span>{formatBytes(report.sizeBytes)}</span>
          <span aria-hidden>·</span>
          <span>{formatTime(report.lastModified)}</span>
        </div>
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
