"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Spinner } from "@/components/ui/spinner";
import { ChatInterface } from "@/features/chat";
import { CHAT_ENDPOINTS } from "@/features/chat";
import { api } from "@/lib/api";
import type { ChatAvatar } from "@/features/chat";

const ASSETS_CDN_BASE = process.env.NEXT_PUBLIC_ASSETS_CDN_URL ?? "https://cdn.karibu.ai";

export default function ChatPage() {

  const { user, isLoading } = useAuth();
  const router = useRouter();
  const chatId = useRef(crypto.randomUUID()).current;

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [user, isLoading, router]);

  // Load user profile to get avatar preference
  const { data: profileData } = useQuery({
    queryKey: ["user", "me"],
    queryFn: api.user.me,
    enabled: !!user,
  });

  // Load available avatars
  const { data: avatarsData } = useQuery({
    queryKey: ["avatars"],
    queryFn: api.avatars.list,
    enabled: !!user,
  });

  // Resolve avatar: use the user's preferred avatar if set
  const avatar = useMemo((): ChatAvatar | undefined => {
    const preferredAvatarId = profileData?.user.preferredAvatarId;
    if (!preferredAvatarId || !avatarsData?.avatars) return undefined;

    const found = avatarsData.avatars.find((a) => a.id === preferredAvatarId);
    if (!found) return undefined;

    return {
      name: found.name,
      voiceId: found.voiceId,
      image: found.imageS3Key ? `${ASSETS_CDN_BASE}/${found.imageS3Key}` : undefined,
    };
  }, [profileData, avatarsData]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="h-screen">
      <ChatInterface
        endpoint={CHAT_ENDPOINTS.assistant}
        chatId={chatId}
        avatar={avatar}
        autoPlayVoice={false}
      />
    </div>
  );
}
