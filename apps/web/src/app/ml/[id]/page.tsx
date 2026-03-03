"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sun, Moon, Monitor, ChevronDown, ArrowLeft, CheckCircle2,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useAuth } from "@/hooks/useAuth";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { ChatInterface } from "@/features/chat";
import { CHAT_ENDPOINTS } from "@/features/chat";
import { api, type Avatar as AvatarType } from "@/lib/api";
import type { ChatAvatar } from "@/features/chat";

const ASSETS_CDN_BASE = process.env.NEXT_PUBLIC_ASSETS_CDN_URL ?? "https://cdn.karibu.ai";

function getAvatarImageUrl(imageS3Key: string | null): string | null {
  return imageS3Key ? `${ASSETS_CDN_BASE}/${imageS3Key}` : null;
}

function buildChatAvatar(avatar: AvatarType | null): ChatAvatar | undefined {
  if (!avatar) return undefined;
  return {
    name: avatar.name,
    voiceId: avatar.voiceId,
    image: getAvatarImageUrl(avatar.imageS3Key) ?? undefined,
  };
}

function getInitials(email: string): string {
  const [local] = email.split("@");
  const parts = local.split(/[._-]/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

const APPEARANCE_OPTIONS: { value: string; label: string; icon: React.ElementType }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export default function MicrolearningChatPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, isLoading: authLoading, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();

  // Stable chatId for this session
  const chatId = useRef(crypto.randomUUID()).current;

  const [isCompleted, setIsCompleted] = useState(false);

  // Load ML details
  const { data: mlData, isLoading: mlLoading } = useQuery({
    queryKey: ["ml", id],
    queryFn: () => api.microlearnings.getById(id),
    enabled: !!id && !!user,
  });

  // Load user profile (for preferred avatar — only for non-admin users)
  const { data: profileData } = useQuery({
    queryKey: ["user", "me"],
    queryFn: api.user.me,
    enabled: !!user && user.role !== "admin",
  });

  // Load available avatars (for preference selector — only for learners)
  const { data: avatarsData } = useQuery({
    queryKey: ["avatars"],
    queryFn: api.avatars.list,
    enabled: !!user && user.role !== "admin",
  });

  // Mutation to update avatar preference
  const updatePreferenceMutation = useMutation({
    mutationFn: (preferredAvatarId: string | null) =>
      api.user.updatePreferences({ preferredAvatarId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user", "me"] });
    },
  });

  // Sync completed state from existing progress
  useEffect(() => {
    if (mlData?.progress?.status === "completed") {
      setIsCompleted(true);
    }
  }, [mlData?.progress?.status]);

  // Auth redirect
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [user, authLoading, router]);

  // Determine effective avatar:
  // - Admin: always use ML's default avatar
  // - User: use their preferred avatar if set, otherwise use ML's default
  const effectiveAvatar = useMemo((): ChatAvatar | undefined => {
    const ml = mlData?.microlearning;
    if (!ml) return undefined;

    if (user?.role === "admin") {
      return buildChatAvatar(ml.avatar);
    }

    // Learner: check for preferred avatar
    const preferredAvatarId = profileData?.user.preferredAvatarId;
    if (preferredAvatarId && avatarsData?.avatars) {
      const preferredAvatar = avatarsData.avatars.find((a) => a.id === preferredAvatarId);
      if (preferredAvatar) return buildChatAvatar(preferredAvatar);
    }

    return buildChatAvatar(ml.avatar);
  }, [mlData, profileData, avatarsData, user?.role]);

  const handleComplete = useCallback(() => {
    setIsCompleted(true);
    queryClient.invalidateQueries({ queryKey: ["ml", id] });
    queryClient.invalidateQueries({ queryKey: ["microlearnings", "my"] });
  }, [queryClient, id]);

  const initials = user?.email ? getInitials(user.email) : "?";

  if (authLoading || mlLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (!user) return null;

  if (!mlData) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Microlearning not found.</p>
      </div>
    );
  }

  const { microlearning } = mlData;

  return (
    <div className="flex h-screen flex-col">
      {/* Top navigation bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.back()}
            aria-label="Go back"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate max-w-[200px] sm:max-w-xs">
              {microlearning.title}
            </span>
            {isCompleted && (
              <Badge variant="outline" className="gap-1 border-green-500 text-green-600 shrink-0">
                <CheckCircle2 className="size-3" />
                Completed
              </Badge>
            )}
          </div>
        </div>

        {/* Account dropdown */}
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
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            {/* Avatar preference — only for learners */}
            {user.role !== "admin" && avatarsData?.avatars && avatarsData.avatars.length > 0 && (
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

      {/* Chat interface fills remaining height */}
      <div className="flex-1 overflow-hidden">
        <ChatInterface
          endpoint={CHAT_ENDPOINTS.ml}
          chatId={chatId}
          microlearningId={id}
          avatar={effectiveAvatar}
          autoPlayVoice={false}
          onComplete={handleComplete}
          className="h-full"
        />
      </div>
    </div>
  );
}
