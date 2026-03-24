"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { ChatAvatar } from "../types";

interface ChatAgentAvatarProps {
  avatar?: ChatAvatar;
  isSpeaking?: boolean;
  size?: "sm" | "md" | "lg";
}

export function ChatAgentAvatar({
  avatar,
  isSpeaking = false,
  size = "md",
}: ChatAgentAvatarProps) {

  const name = avatar?.name ?? "AI";

  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const sizeClass = {
    sm: "w-8 h-8",
    md: "w-10 h-10",
    lg: "w-12 h-12",
  }[size];

  return (
    <div className={cn("relative shrink-0", sizeClass)}>
      <Avatar
        className={cn(
          sizeClass,
          "transition-all",
          isSpeaking && "ring-2 ring-primary ring-offset-2"
        )}
      >
        {avatar?.image && (
          <AvatarImage src={avatar.image} alt={name} />
        )}
        <AvatarFallback className="text-xs font-medium">
          {initials}
        </AvatarFallback>
      </Avatar>
      {isSpeaking && (
        <span className="absolute inset-0 -z-10 rounded-full animate-ping bg-primary/20" />
      )}
    </div>
  );
}
