"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users,
  UserPlus,
  Mail,
  RefreshCw,
  Trash2,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Clock,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import { api, type TeamMember, type InviteResult } from "@/lib/api";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function MemberStatusBadge({ member }: { member: TeamMember }) {
  if (member.role === "admin") {
    return (
      <Badge className="gap-1 text-xs bg-violet-100 text-violet-700 hover:bg-violet-100 border-0">
        <ShieldCheck className="size-3" />
        Admin
      </Badge>
    );
  }

  if (member.tokenLastUsedAt) {
    return (
      <Badge className="gap-1 text-xs bg-green-100 text-green-700 hover:bg-green-100 border-0">
        <CheckCircle2 className="size-3" />
        Active
      </Badge>
    );
  }

  if (member.tokenExpired) {
    return (
      <Badge className="gap-1 text-xs bg-red-100 text-red-700 hover:bg-red-100 border-0">
        <AlertCircle className="size-3" />
        Expired
      </Badge>
    );
  }

  return (
    <Badge className="gap-1 text-xs bg-yellow-100 text-yellow-700 hover:bg-yellow-100 border-0">
      <Clock className="size-3" />
      Invited
    </Badge>
  );
}

// ─── Invite form ─────────────────────────────────────────────────────────────

interface InviteFormProps {
  onClose: () => void;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function InviteForm({ onClose }: InviteFormProps) {
  const queryClient = useQueryClient();
  const [chips, setChips] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<InviteResult | null>(null);

  const inviteMutation = useMutation({
    mutationFn: (emailList: string[]) => api.team.invite(emailList.join(", ")),
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["team"] });
    },
  });

  const removeEmail = (email: string) => {
    setChips(chips.filter((e) => e !== email));
  };

  const handleInputChange = (value: string) => {
    setInput(value);

    // Split by comma or newline to handle both separators
    const separatorRegex = /[,\n]/;
    if (separatorRegex.test(value)) {
      const parts = value.split(separatorRegex);
      const newEmails: string[] = [];

      // Process all parts except the last one (which may be incomplete)
      for (let i = 0; i < parts.length - 1; i++) {
        const trimmed = parts[i].trim();
        if (trimmed && isValidEmail(trimmed) && !chips.includes(trimmed) && !newEmails.includes(trimmed)) {
          newEmails.push(trimmed);
        }
      }

      // Update chips with all new emails at once
      if (newEmails.length > 0) {
        setChips((prevChips) => [...prevChips, ...newEmails]);
      }

      // Keep the last part as the current input
      setInput(parts[parts.length - 1]);
    }
  };

  const handleBlur = () => {
    if (input.trim()) {
      const trimmed = input.trim();
      if (isValidEmail(trimmed) && !chips.includes(trimmed)) {
        setChips((prevChips) => [...prevChips, trimmed]);
      }
      setInput("");
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);

    // Collect all emails including any remaining input
    let allEmails = [...chips];
    if (input.trim()) {
      const trimmed = input.trim();
      if (isValidEmail(trimmed) && !chips.includes(trimmed)) {
        allEmails.push(trimmed);
      }
    }

    if (allEmails.length > 0) {
      setChips(allEmails);
      setInput("");
      inviteMutation.mutate(allEmails);
    }
  };

  const hasSent = result !== null;
  const hasAnything = hasSent && (
    result.invited.length > 0 ||
    result.alreadyExists.length > 0 ||
    result.failed.length > 0
  );

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3 pt-4 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Invite team members</CardTitle>
          <Button variant="ghost" size="icon" className="size-7" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5 space-y-4">
        {!hasSent ? (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">
                Email addresses
              </label>
              {chips.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {chips.map((email) => (
                    <div
                      key={email}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-900"
                    >
                      <span>{email}</span>
                      <button
                        type="button"
                        onClick={() => removeEmail(email)}
                        className="text-blue-600 hover:text-blue-800 cursor-pointer"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="alice@example.com, bob@example.com"
                value={input}
                onChange={(e) => handleInputChange(e.target.value)}
                onBlur={handleBlur}
              />
            </div>
            {inviteMutation.isError && (
              <p className="text-sm text-destructive">{(inviteMutation.error as Error).message}</p>
            )}
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={inviteMutation.isPending || (chips.length === 0 && input.trim() === "")}
              >
                {inviteMutation.isPending && <Spinner className="mr-1.5 size-3.5" />}
                Send invitations {chips.length > 0 && `(${chips.length})`}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            {result.invited.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-green-700">
                  Invited ({result.invited.length})
                </p>
                <ul className="text-xs text-muted-foreground space-y-0.5 pl-2">
                  {result.invited.map((e) => <li key={e}>{e}</li>)}
                </ul>
              </div>
            )}
            {result.alreadyExists.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-yellow-700">
                  Already a member ({result.alreadyExists.length})
                </p>
                <ul className="text-xs text-muted-foreground space-y-0.5 pl-2">
                  {result.alreadyExists.map((e) => <li key={e}>{e}</li>)}
                </ul>
              </div>
            )}
            {result.failed.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-destructive">
                  Failed ({result.failed.length})
                </p>
                <ul className="text-xs text-muted-foreground space-y-0.5 pl-2">
                  {result.failed.map((e) => <li key={e}>{e}</li>)}
                </ul>
              </div>
            )}
            {!hasAnything && (
              <p className="text-sm text-muted-foreground">No emails were processed.</p>
            )}
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setResult(null);
                  setChips([]);
                  setInput("");
                }}
              >
                Invite more
              </Button>
              <Button size="sm" variant="ghost" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Member row actions ───────────────────────────────────────────────────────

interface MemberActionsProps {
  member: TeamMember;
  onAction: (action: "resend" | "regenerate" | "remove", id: string) => void;
  isPending: boolean;
}

function MemberActions({ member, onAction, isPending }: MemberActionsProps) {
  if (member.role === "admin") return null;

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-foreground"
        title="Resend invitation email"
        disabled={isPending}
        onClick={() => onAction("resend", member.id)}
      >
        <Mail className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-foreground"
        title="Regenerate sign-in token and resend email"
        disabled={isPending}
        onClick={() => onAction("regenerate", member.id)}
      >
        <RefreshCw className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-destructive"
        title="Remove from team"
        disabled={isPending}
        onClick={() => onAction("remove", member.id)}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}

// ─── Member row ───────────────────────────────────────────────────────────────

interface MemberRowProps {
  member: TeamMember;
  isLast: boolean;
  isPending: boolean;
  onAction: (action: "resend" | "regenerate" | "remove", id: string) => void;
}

function MemberRow({ member, isLast, isPending, onAction }: MemberRowProps) {
  return (
    <tr className={["hover:bg-muted/30 transition-colors", !isLast ? "border-b" : ""].join(" ")}>
      <td className="px-5 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="size-7 rounded-full bg-muted flex items-center justify-center text-xs font-medium shrink-0 uppercase">
            {member.email[0]}
          </div>
          <span className="truncate">{member.email}</span>
          {isPending && <Spinner className="size-3.5 text-muted-foreground shrink-0" />}
        </div>
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <MemberStatusBadge member={member} />
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground hidden sm:table-cell">
        {formatDate(member.createdAt)}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground hidden md:table-cell">
        {member.tokenLastUsedAt ? formatDate(member.tokenLastUsedAt) : "—"}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <MemberActions member={member} onAction={onAction} isPending={isPending} />
      </td>
    </tr>
  );
}

// ─── Main section ─────────────────────────────────────────────────────────────

export function TeamSection() {
  const queryClient = useQueryClient();
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["team"],
    queryFn: () => api.team.list(),
  });

  const resendMutation = useMutation({
    mutationFn: (userId: string) => api.team.resendInvite(userId),
    onSuccess: () => setPendingUserId(null),
    onError: (err) => {
      setActionError((err as Error).message);
      setPendingUserId(null);
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: (userId: string) => api.team.regenerateToken(userId),
    onSuccess: () => {
      setPendingUserId(null);
      queryClient.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (err) => {
      setActionError((err as Error).message);
      setPendingUserId(null);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => api.team.remove(userId),
    onSuccess: () => {
      setPendingUserId(null);
      queryClient.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (err) => {
      setActionError((err as Error).message);
      setPendingUserId(null);
    },
  });

  const handleAction = (action: "resend" | "regenerate" | "remove", userId: string) => {
    setActionError(null);
    setPendingUserId(userId);

    if (action === "resend") resendMutation.mutate(userId);
    else if (action === "regenerate") regenerateMutation.mutate(userId);
    else removeMutation.mutate(userId);
  };

  const members = data?.users ?? [];
  const admins = members.filter((m) => m.role === "admin");
  const regularUsers = members.filter((m) => m.role === "user");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Team</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your organization's members and their access.
          </p>
        </div>
        {!showInviteForm && (
          <Button size="sm" onClick={() => setShowInviteForm(true)}>
            <UserPlus className="size-4 mr-1.5" />
            Invite
          </Button>
        )}
      </div>

      {showInviteForm && (
        <InviteForm onClose={() => setShowInviteForm(false)} />
      )}

      {actionError && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          {actionError}
          <button
            className="ml-auto text-destructive/70 hover:text-destructive"
            onClick={() => setActionError(null)}
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {isLoading && (
        <Card className="min-h-48 flex items-center justify-center">
          <Spinner className="size-5 text-muted-foreground" />
        </Card>
      )}

      {isError && (
        <Card className="min-h-48 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <AlertCircle className="size-4" />
          Failed to load team members.
        </Card>
      )}

      {!isLoading && !isError && members.length === 0 && (
        <Card className="min-h-48 flex flex-col items-center justify-center gap-3">
          <Users className="size-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No team members yet. Invite someone to get started.</p>
        </Card>
      )}

      {!isLoading && !isError && members.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left font-medium text-muted-foreground px-5 py-3 w-full">
                    Member
                  </th>
                  <th className="text-left font-medium text-muted-foreground px-4 py-3 whitespace-nowrap">
                    Status
                  </th>
                  <th className="text-left font-medium text-muted-foreground px-4 py-3 whitespace-nowrap hidden sm:table-cell">
                    Joined
                  </th>
                  <th className="text-left font-medium text-muted-foreground px-4 py-3 whitespace-nowrap hidden md:table-cell">
                    Last sign-in
                  </th>
                  <th className="px-4 py-3 w-0" />
                </tr>
              </thead>
              <tbody>
                {admins.map((member, i) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    isLast={i === admins.length - 1 && regularUsers.length === 0}
                    isPending={pendingUserId === member.id}
                    onAction={handleAction}
                  />
                ))}
                {admins.length > 0 && regularUsers.length > 0 && (
                  <tr>
                    <td colSpan={5}>
                      <Separator />
                    </td>
                  </tr>
                )}
                {regularUsers.map((member, i) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    isLast={i === regularUsers.length - 1}
                    isPending={pendingUserId === member.id}
                    onAction={handleAction}
                  />
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
