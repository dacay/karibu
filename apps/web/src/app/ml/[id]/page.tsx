"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useConfetti } from "@/hooks/useConfetti";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AccountMenu } from "@/components/AccountMenu";
import { ChatInterface } from "@/features/chat";
import { CHAT_ENDPOINTS } from "@/features/chat";
import { api, type Avatar as AvatarType } from "@/lib/api";
import type { ChatAvatar } from "@/features/chat";
import type { UIMessage } from "ai";
import { getVersionedAssetUrl } from "@/lib/assets";

function buildChatAvatar(avatar: AvatarType | null): ChatAvatar | undefined {
  if (!avatar) return undefined;
  return {
    name: avatar.name,
    voiceId: avatar.voiceId,
    image: avatar.imageS3Key ? getVersionedAssetUrl(avatar.imageS3Key, avatar.updatedAt) : undefined,
  };
}

export default function MicrolearningChatPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  // Admin test mode: opened via the Test button in the admin view
  const isAdminTest = user?.role === "admin" && searchParams.get("test") === "true";
  const [adminTestChatId, setAdminTestChatId] = useState<string>(() => crypto.randomUUID());

  // Resolved chatId + prior messages — set once when the session loads
  const chatIdRef = useRef<string | null>(null);
  const initialMessagesRef = useRef<UIMessage[]>([]);

  const [isCompleted, setIsCompleted] = useState(false);
  const { fire: fireConfetti } = useConfetti();

  // Load ML details
  const { data: mlData, isLoading: mlLoading } = useQuery({
    queryKey: ["ml", id],
    queryFn: () => api.microlearnings.getById(id),
    enabled: !!id && !!user,
  });

  // Load previous chat session (chatId + messages) for this ML.
  // gcTime: 0 clears the cache on unmount so each visit fetches fresh data.
  // staleTime: Infinity prevents background refetches while the page is open.
  // Admin test sessions always start fresh — skip loading previous chat history
  const { data: sessionData, isLoading: sessionLoading } = useQuery({
    queryKey: ["chat", "ml", id],
    queryFn: () => api.chat.loadMLSession(id),
    enabled: !!id && !!user && !isAdminTest,
    staleTime: Infinity,
    gcTime: 0,
  });

  // Invalidate the learner feed on unmount so "In Progress" is visible when
  // the user navigates back, without waiting for a manual refresh.
  useEffect(() => {
    return () => {
      queryClient.invalidateQueries({ queryKey: ["learner", "feed"] });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolve chatId: use existing one if found, otherwise generate a stable new one.
  // In admin test mode, use a fresh UUID so each test (and each restart) is isolated.
  if (!isAdminTest && !chatIdRef.current) {
    if (sessionData) {
      chatIdRef.current = sessionData.chatId ?? crypto.randomUUID();
      initialMessagesRef.current = (sessionData.messages as UIMessage[]) ?? [];
    }
  }
  const chatId = isAdminTest ? adminTestChatId : (chatIdRef.current ?? crypto.randomUUID());
  const initialMessages: UIMessage[] = isAdminTest ? [] : initialMessagesRef.current;

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

    // Learner: preferred avatar overrides, otherwise use the ML's own avatar
    const preferredAvatarId = profileData?.user.preferredAvatarId;
    if (preferredAvatarId && avatarsData?.avatars) {
      const preferredAvatar = avatarsData.avatars.find((a) => a.id === preferredAvatarId);
      if (preferredAvatar) return buildChatAvatar(preferredAvatar);
    }

    return buildChatAvatar(ml.avatar);
  }, [mlData, profileData, avatarsData, user?.role]);

  // Restart the admin test session with a fresh chat ID and no prior messages
  const handleRestart = useCallback(() => {
    setAdminTestChatId(crypto.randomUUID());
    setIsCompleted(false);
  }, []);

  const handleComplete = useCallback(() => {
    setIsCompleted(true);
    // fireConfetti();
    queryClient.invalidateQueries({ queryKey: ["ml", id] });
    queryClient.invalidateQueries({ queryKey: ["microlearnings", "my"] });
    queryClient.invalidateQueries({ queryKey: ["learner", "feed"] });
    queryClient.invalidateQueries({ queryKey: ["chat", "ml", id] });
  }, [queryClient, id, fireConfetti]);

  if (authLoading || mlLoading || sessionLoading) {
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
            onClick={() => user?.role === "admin" ? router.push("/microlearnings") : router.back()}
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

        <AccountMenu />
      </header>

      {/* Chat interface fills remaining height */}
      <div className="flex-1 overflow-hidden">
        <ChatInterface
          key={isAdminTest ? adminTestChatId : undefined}
          endpoint={CHAT_ENDPOINTS.ml}
          chatId={chatId}
          initialMessages={initialMessages}
          microlearningId={id}
          avatar={effectiveAvatar}
          autoPlayVoice={false}
          onComplete={handleComplete}
          onRestart={isAdminTest ? handleRestart : undefined}
          className="h-full"
        />
      </div>
    </div>
  );
}
