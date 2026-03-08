"use client";

import { useState } from "react";
import { Flag } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { ChatAgentAvatar } from "./ChatAgentAvatar";
import { api } from "@/lib/api";
import type { UIMessage } from "ai";
import type { ChatAvatar } from "../types";

interface ChatMessageProps {
  message: UIMessage;
  chatId: string;
  avatar?: ChatAvatar;
  isSpeaking?: boolean;
}

function extractText(message: UIMessage): string {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text)
    .join("");
}

export function ChatMessage({ message, chatId, avatar, isSpeaking = false }: ChatMessageProps) {

  const isAssistant = message.role === "assistant";
  const text = extractText(message);
  const [flagged, setFlagged] = useState(false);
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState("");

  const flagMutation = useMutation({
    mutationFn: (r?: string) =>
      api.flags.flag({ messageId: message.id, chatId, reason: r || undefined }),
    onSuccess: () => {
      setFlagged(true);
      setShowReason(false);
      setReason("");
    },
  });

  if (!text) return null;

  return (
    <div
      className={cn(
        "group flex items-end gap-2",
        isAssistant ? "flex-row" : "flex-row-reverse"
      )}
    >
      {isAssistant && (
        <ChatAgentAvatar avatar={avatar} size="sm" isSpeaking={isSpeaking} />
      )}

      <div className="flex flex-col gap-1 max-w-[75%]">
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isAssistant
              ? "rounded-bl-sm bg-muted text-foreground"
              : "rounded-br-sm bg-primary text-primary-foreground"
          )}
        >
          {text}
        </div>

        {/* Reason input shown below the bubble when flag button clicked */}
        {showReason && (
          <div className="flex flex-col gap-1.5 rounded-xl border bg-background p-3 shadow-sm text-xs">
            <p className="font-medium text-muted-foreground">Why are you flagging this? (optional)</p>
            <textarea
              className="resize-none rounded-md border bg-muted px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              rows={2}
              placeholder="e.g. factually incorrect, misleading…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                onClick={() => flagMutation.mutate(reason)}
                disabled={flagMutation.isPending}
                className="rounded-md bg-destructive px-3 py-1 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
              >
                {flagMutation.isPending ? "Flagging…" : "Submit"}
              </button>
              <button
                onClick={() => { setShowReason(false); setReason(""); }}
                className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Flag button — appears on group hover */}
      {!flagged && !showReason && (
        <button
          onClick={() => setShowReason(true)}
          className={cn(
            "shrink-0 self-center rounded-full p-1.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-destructive",
            !isAssistant && "order-first"
          )}
          title="Flag as inaccurate"
        >
          <Flag className="size-3.5" />
        </button>
      )}

      {flagged && (
        <span
          className={cn(
            "shrink-0 self-center rounded-full p-1.5 text-amber-500",
            !isAssistant && "order-first"
          )}
          title="Flagged — admins will review this"
        >
          <Flag className="size-3.5" />
        </span>
      )}
    </div>
  );
}
