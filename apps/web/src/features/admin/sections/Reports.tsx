"use client";

import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileText,
  Download,
  Eye,
  Plus,
  Pencil,
  Trash2,
  Tag,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, type ReportFile, type ReportDescription } from "@/lib/api";

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
    <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-sm">
      <FileText className="size-5 shrink-0 text-muted-foreground" />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{report.name}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {report.description && (
            <span className="text-foreground/80">{report.description}</span>
          )}
          {report.description && <span aria-hidden>·</span>}
          <span>{formatBytes(report.sizeBytes)}</span>
          <span aria-hidden>·</span>
          <span>{formatTime(report.lastModified)}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
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

// ─── Description rule form ───────────────────────────────────────────────────────

interface DescriptionFormProps {
  open: boolean;
  title: string;
  initialMatchText?: string;
  initialDescription?: string;
  onSave: (values: { matchText: string; description: string }) => void;
  onCancel: () => void;
  isLoading: boolean;
  submitLabel?: string;
}

function DescriptionForm({
  open,
  title,
  initialMatchText = "",
  initialDescription = "",
  onSave,
  onCancel,
  isLoading,
  submitLabel = "Save",
}: DescriptionFormProps) {
  const [matchText, setMatchText] = useState(initialMatchText);
  const [description, setDescription] = useState(initialDescription);

  useEffect(() => {
    if (open) {
      setMatchText(initialMatchText);
      setDescription(initialDescription);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const valid = matchText.trim().length > 0 && description.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Filename contains</label>
            <Input
              placeholder='e.g. "monthly-summary"'
              value={matchText}
              onChange={(e) => setMatchText(e.target.value)}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Case-insensitive. Any report whose filename contains this text gets the description below.
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Description</label>
            <Input
              placeholder="e.g. Monthly engagement summary"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              disabled={!valid || isLoading}
              onClick={() => onSave({ matchText, description })}
            >
              {isLoading ? <Spinner className="size-3 mr-1" /> : null}
              {submitLabel}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Description rules manager ───────────────────────────────────────────────────

function DescriptionRules() {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ReportDescription | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["reports", "descriptions"],
    queryFn: api.reports.descriptions.list,
  });

  const rules = data?.descriptions ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["reports"] });
  };

  const createMutation = useMutation({
    mutationFn: api.reports.descriptions.create,
    onSuccess: () => {
      invalidate();
      setCreating(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: string; matchText: string; description: string }) =>
      api.reports.descriptions.update(id, body),
    onSuccess: () => {
      invalidate();
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.reports.descriptions.delete(id),
    onSuccess: invalidate,
  });

  return (
    <Card>
      <CardContent className="p-0">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left"
        >
          {expanded ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
          <Tag className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Description rules</span>
          <span className="text-xs text-muted-foreground">
            {rules.length > 0 ? `${rules.length} rule${rules.length === 1 ? "" : "s"}` : "None yet"}
          </span>
        </button>

        {expanded && (
          <div className="border-t px-4 py-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              Rules attach a description to report files by matching their filename. When several rules
              match a file, the most specific (longest match) wins.
            </p>

            {isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : rules.length === 0 ? (
              <p className="text-sm text-muted-foreground">No description rules yet.</p>
            ) : (
              <div className="space-y-1.5">
                {rules.map((rule) => (
                  <div
                    key={rule.id}
                    className="flex items-center gap-3 rounded-md border bg-background px-3 py-2"
                  >
                    <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                      {rule.matchText}
                    </code>
                    <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                      {rule.description}
                    </span>
                    <button
                      onClick={() => setEditing(rule)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Edit rule"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      onClick={() => deleteMutation.mutate(rule.id)}
                      disabled={deleteMutation.isPending}
                      className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                      aria-label="Delete rule"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setCreating(true)}>
              <Plus className="size-3.5" />
              Add rule
            </Button>
          </div>
        )}
      </CardContent>

      <DescriptionForm
        open={creating}
        title="Add description rule"
        onSave={(values) => createMutation.mutate(values)}
        onCancel={() => setCreating(false)}
        isLoading={createMutation.isPending}
        submitLabel="Add"
      />

      <DescriptionForm
        open={editing !== null}
        title="Edit description rule"
        initialMatchText={editing?.matchText}
        initialDescription={editing?.description}
        onSave={(values) => {
          if (editing) updateMutation.mutate({ id: editing.id, ...values });
        }}
        onCancel={() => setEditing(null)}
        isLoading={updateMutation.isPending}
      />
    </Card>
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

      <DescriptionRules />

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
