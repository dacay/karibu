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
  Link,
  Check,
  X,
  ChevronRight,
  ArrowLeft,
  Plus,
  Pencil,
  UsersRound,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { api, type TeamMember, type InviteResult, type UserGroup } from "@/lib/api";
import { LearnerDetailView } from "./LearnerDetail";

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

    const separatorRegex = /[,\n]/;
    if (separatorRegex.test(value)) {
      const parts = value.split(separatorRegex);
      const newEmails: string[] = [];

      for (let i = 0; i < parts.length - 1; i++) {
        const trimmed = parts[i].trim();
        if (trimmed && isValidEmail(trimmed) && !chips.includes(trimmed) && !newEmails.includes(trimmed)) {
          newEmails.push(trimmed);
        }
      }

      if (newEmails.length > 0) {
        setChips((prevChips) => [...prevChips, ...newEmails]);
      }

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
  onAction: (action: "resend" | "regenerate" | "remove" | "copyLink", id: string) => void;
  isPending: boolean;
  copiedUserId: string | null;
}

function MemberActions({ member, onAction, isPending, copiedUserId }: MemberActionsProps) {
  if (member.role === "admin") return null;

  const isCopied = copiedUserId === member.id;

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-foreground"
        title="Copy sign-in link"
        disabled={isPending}
        onClick={(e) => { e.stopPropagation(); onAction("copyLink", member.id); }}
      >
        {isCopied ? <Check className="size-3.5 text-green-600" /> : <Link className="size-3.5" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-foreground"
        title="Resend invitation email"
        disabled={isPending}
        onClick={(e) => { e.stopPropagation(); onAction("resend", member.id); }}
      >
        <Mail className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-foreground"
        title="Regenerate sign-in token and resend email"
        disabled={isPending}
        onClick={(e) => { e.stopPropagation(); onAction("regenerate", member.id); }}
      >
        <RefreshCw className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-destructive"
        title="Remove from team"
        disabled={isPending}
        onClick={(e) => { e.stopPropagation(); onAction("remove", member.id); }}
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
  onAction: (action: "resend" | "regenerate" | "remove" | "copyLink", id: string) => void;
  copiedUserId: string | null;
  onSelect: (member: TeamMember) => void;
}

function MemberRow({ member, isLast, isPending, onAction, copiedUserId, onSelect }: MemberRowProps) {
  const isClickable = member.role !== "admin";

  return (
    <tr
      className={[
        "transition-colors",
        !isLast ? "border-b" : "",
        isClickable ? "hover:bg-muted/50 cursor-pointer" : "hover:bg-muted/30",
      ].join(" ")}
      onClick={isClickable ? () => onSelect(member) : undefined}
    >
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
      <td className="px-4 py-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
        <MemberActions member={member} onAction={onAction} isPending={isPending} copiedUserId={copiedUserId} />
      </td>
      {isClickable && (
        <td className="px-2 py-3">
          <ChevronRight className="size-4 text-muted-foreground" />
        </td>
      )}
    </tr>
  );
}

// ─── Members tab ────────────────────────────────────────────────────────────

function MembersTab() {
  const queryClient = useQueryClient();
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [copiedUserId, setCopiedUserId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);

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

  const handleAction = (action: "resend" | "regenerate" | "remove" | "copyLink", userId: string) => {
    setActionError(null);

    if (action === "copyLink") {
      setPendingUserId(userId);
      api.team.getLink(userId).then(({ link }) => {
        navigator.clipboard.writeText(link);
        setCopiedUserId(userId);
        setPendingUserId(null);
        setTimeout(() => setCopiedUserId(null), 2000);
      }).catch((err) => {
        setActionError((err as Error).message);
        setPendingUserId(null);
      });
      return;
    }

    setPendingUserId(userId);
    if (action === "resend") resendMutation.mutate(userId);
    else if (action === "regenerate") regenerateMutation.mutate(userId);
    else removeMutation.mutate(userId);
  };

  // If a member is selected, show their detail view
  if (selectedMember) {
    return (
      <LearnerDetailView
        userId={selectedMember.id}
        email={selectedMember.email}
        onBack={() => setSelectedMember(null)}
      />
    );
  }

  const members = data?.users ?? [];
  const admins = members.filter((m) => m.role === "admin");
  const regularUsers = members.filter((m) => m.role === "user");

  return (
    <div className="space-y-4">
      {!showInviteForm && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setShowInviteForm(true)}>
            <UserPlus className="size-4 mr-1.5" />
            Invite
          </Button>
        </div>
      )}

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
                  <th className="px-2 py-3 w-0" />
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
                    copiedUserId={copiedUserId}
                    onSelect={setSelectedMember}
                  />
                ))}
                {admins.length > 0 && regularUsers.length > 0 && (
                  <tr>
                    <td colSpan={6}>
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
                    copiedUserId={copiedUserId}
                    onSelect={setSelectedMember}
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

// ─── Groups tab ──────────────────────────────────────────────────────────────

function GroupsTab() {
  const queryClient = useQueryClient();
  const [newGroupName, setNewGroupName] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingGroup, setEditingGroup] = useState<UserGroup | null>(null);
  const [editName, setEditName] = useState("");
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["userGroups"],
    queryFn: () => api.userGroups.list(),
  });

  const { data: teamData } = useQuery({
    queryKey: ["team"],
    queryFn: () => api.team.list(),
  });

  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ["userGroups", expandedGroupId, "members"],
    queryFn: () => api.userGroups.listMembers(expandedGroupId!),
    enabled: !!expandedGroupId,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => api.userGroups.create({ name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userGroups"] });
      setNewGroupName("");
      setShowCreateDialog(false);
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.userGroups.update(id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userGroups"] });
      setEditingGroup(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.userGroups.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userGroups"] });
      if (expandedGroupId) setExpandedGroupId(null);
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: ({ groupId, userId }: { groupId: string; userId: string }) =>
      api.userGroups.addMember(groupId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userGroups"] });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: ({ groupId, userId }: { groupId: string; userId: string }) =>
      api.userGroups.removeMember(groupId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userGroups"] });
    },
  });

  const groups = data?.groups ?? [];
  const allUsers = (teamData?.users ?? []).filter((u) => u.role === "user");
  const groupMembers = membersData?.members ?? [];
  const groupMemberIds = new Set(groupMembers.map((m) => m.id));
  const nonMembers = allUsers.filter((u) => !groupMemberIds.has(u.id));

  if (isLoading) {
    return (
      <Card className="min-h-48 flex items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </Card>
    );
  }

  // Expanded group detail view
  if (expandedGroupId) {
    const group = groups.find((g) => g.id === expandedGroupId);
    if (!group) return null;

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setExpandedGroupId(null)}>
            <ArrowLeft className="size-4 mr-1" />
            Back
          </Button>
          <h3 className="text-lg font-semibold">{group.name}</h3>
          {group.isAll && (
            <Badge variant="outline" className="text-xs">Auto-managed</Badge>
          )}
        </div>

        {/* Add member */}
        {!group.isAll && nonMembers.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              id="add-member-select"
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  addMemberMutation.mutate({ groupId: group.id, userId: e.target.value });
                  e.target.value = "";
                }
              }}
            >
              <option value="" disabled>Add a member...</option>
              {nonMembers.map((u) => (
                <option key={u.id} value={u.id}>{u.email}</option>
              ))}
            </select>
          </div>
        )}

        {membersLoading ? (
          <div className="flex justify-center py-8">
            <Spinner className="size-5 text-muted-foreground" />
          </div>
        ) : groupMembers.length === 0 ? (
          <Card className="py-8 flex flex-col items-center justify-center gap-2">
            <Users className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No members in this group.</p>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left font-medium text-muted-foreground px-5 py-3 w-full">Member</th>
                    {!group.isAll && <th className="px-4 py-3 w-0" />}
                  </tr>
                </thead>
                <tbody>
                  {groupMembers.map((member, i) => (
                    <tr key={member.id} className={["hover:bg-muted/30 transition-colors", i < groupMembers.length - 1 ? "border-b" : ""].join(" ")}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="size-7 rounded-full bg-muted flex items-center justify-center text-xs font-medium shrink-0 uppercase">
                            {member.email[0]}
                          </div>
                          <span>{member.email}</span>
                        </div>
                      </td>
                      {!group.isAll && (
                        <td className="px-4 py-3">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-destructive"
                            title="Remove from group"
                            onClick={() => removeMemberMutation.mutate({ groupId: group.id, userId: member.id })}
                          >
                            <X className="size-3.5" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="size-4 mr-1.5" />
              New group
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create group</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newGroupName.trim()) createMutation.mutate(newGroupName.trim());
              }}
              className="space-y-4"
            >
              <Input
                placeholder="Group name"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowCreateDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={!newGroupName.trim() || createMutation.isPending}>
                  {createMutation.isPending && <Spinner className="mr-1.5 size-3.5" />}
                  Create
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Rename dialog */}
      <Dialog open={!!editingGroup} onOpenChange={(open) => !open && setEditingGroup(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rename group</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (editingGroup && editName.trim()) {
                renameMutation.mutate({ id: editingGroup.id, name: editName.trim() });
              }
            }}
            className="space-y-4"
          >
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditingGroup(null)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!editName.trim() || renameMutation.isPending}>
                {renameMutation.isPending && <Spinner className="mr-1.5 size-3.5" />}
                Save
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {groups.length === 0 ? (
        <Card className="min-h-48 flex flex-col items-center justify-center gap-3">
          <UsersRound className="size-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No groups yet. Create one to organize your learners.</p>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left font-medium text-muted-foreground px-5 py-3 w-full">Group</th>
                  <th className="text-left font-medium text-muted-foreground px-4 py-3 whitespace-nowrap">Members</th>
                  <th className="text-left font-medium text-muted-foreground px-4 py-3 whitespace-nowrap hidden sm:table-cell">Created</th>
                  <th className="px-4 py-3 w-0" />
                </tr>
              </thead>
              <tbody>
                {groups.map((group, i) => (
                  <tr
                    key={group.id}
                    className={["hover:bg-muted/50 cursor-pointer transition-colors", i < groups.length - 1 ? "border-b" : ""].join(" ")}
                    onClick={() => setExpandedGroupId(group.id)}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <UsersRound className="size-4 text-muted-foreground shrink-0" />
                        <span className="font-medium">{group.name}</span>
                        {group.isAll && (
                          <Badge variant="outline" className="text-[10px]">All</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{group.memberCount}</td>
                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{formatDate(group.createdAt)}</td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      {!group.isAll && (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-foreground"
                            title="Rename"
                            onClick={() => {
                              setEditingGroup(group);
                              setEditName(group.name);
                            }}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-destructive"
                            title="Delete group"
                            onClick={() => {
                              if (confirm(`Delete group "${group.name}"?`)) {
                                deleteMutation.mutate(group.id);
                              }
                            }}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Main section ─────────────────────────────────────────────────────────────

type TabId = "members" | "groups";

export function TeamSection() {
  const [activeTab, setActiveTab] = useState<TabId>("members");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Team</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your organization's members, groups, and view learner activity.
        </p>
      </div>

      {/* Tab buttons */}
      <div className="flex gap-1 border-b">
        {([
          { id: "members" as TabId, label: "Members", icon: Users },
          { id: "groups" as TabId, label: "Groups", icon: UsersRound },
        ]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={[
              "flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer",
              activeTab === id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/50",
            ].join(" ")}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "members" && <MembersTab />}
      {activeTab === "groups" && <GroupsTab />}
    </div>
  );
}
