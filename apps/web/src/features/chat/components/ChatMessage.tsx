"use client";

import React, { useState } from "react";
import { Flag, BadgeCheck, FileText, Globe } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { ChatAgentAvatar } from "./ChatAgentAvatar";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import type { UIMessage } from "ai";
import type { ChatAvatar } from "../types";

interface ChatMessageProps {
  message: UIMessage;
  chatId: string;
  avatar?: ChatAvatar;
  isSpeaking?: boolean;
  isLatestAssistant?: boolean;
  onOptionClick?: (text: string) => void;
}

type DataSource = "source" | "document" | "general";

const DATA_SOURCE_CONFIG: Record<DataSource, { icon: React.ElementType; label: (orgName?: string) => string }> = {
  source: { icon: BadgeCheck, label: (orgName) => `${orgName ? `${orgName} ` : ""}Verified` },
  document: { icon: FileText, label: (orgName) => `${orgName ? `${orgName} ` : ""}Documents` },
  general: { icon: Globe, label: () => "General Knowledge" },
};

function extractText(message: UIMessage): string {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text)
    .join("");
}

function extractOptions(message: UIMessage): string[] {

  for (const part of message.parts) {

    if (part.type !== "tool-offerOptions") continue;

    const input = (part as { input?: { options?: unknown } }).input;
    const options = input?.options;

    if (Array.isArray(options) && options.every((o) => typeof o === "string" && o.length > 0)) {
      return options as string[];
    }
  }

  return [];
}

export function ChatMessage({
  message,
  chatId,
  avatar,
  isSpeaking = false,
  isLatestAssistant = false,
  onOptionClick,
}: ChatMessageProps) {

  const isAssistant = message.role === "assistant";
  const text = extractText(message);
  const options = isAssistant ? extractOptions(message) : [];
  const [flagged, setFlagged] = useState(false);
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState("");
  const { user } = useAuth();

  const flagMutation = useMutation({
    mutationFn: (r?: string) =>
      api.flags.flag({ messageId: message.id, chatId, reason: r || undefined }),
    onSuccess: () => {
      setFlagged(true);
      setShowReason(false);
      setReason("");
    },
  });

  if (!text && options.length === 0) return null;

  const dataSource = (message.metadata as { dataSource?: DataSource } | undefined)?.dataSource;
  const sourceConfig = isAssistant && dataSource ? DATA_SOURCE_CONFIG[dataSource] : null;

  return (
    <div className="flex flex-col gap-0.5">
      <div
        className={cn(
          "group flex items-end gap-2",
          isAssistant ? "flex-row" : "flex-row-reverse"
        )}
      >
        {isAssistant && (
          <ChatAgentAvatar avatar={avatar} size="sm" isSpeaking={isSpeaking} />
        )}

        <div className={cn("flex flex-col gap-1 max-w-[75%]", isAssistant ? "items-start" : "items-end")}>
          <div
            className={cn(
              "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
              isAssistant
                ? "rounded-bl-sm bg-muted text-foreground"
                : "rounded-br-sm bg-primary text-primary-foreground"
            )}
          >
            {isAssistant ? (
              <ReactMarkdown
                components={{
                  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                  ul: ({ children }) => <ul className="mb-2 list-disc pl-4 last:mb-0">{children}</ul>,
                  ol: ({ children }) => <ol className="mb-2 list-decimal pl-4 last:mb-0">{children}</ol>,
                  li: ({ children }) => <li className="mb-0.5">{children}</li>,
                  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                  em: ({ children }) => <em className="italic">{children}</em>,
                  hr: () => <hr className="my-3 border-border" />,
                  code: ({ children }) => <code className="rounded bg-background/50 px-1 py-0.5 font-mono text-xs">{children}</code>,
                }}
              >
                {text}
              </ReactMarkdown>
            ) : (
              text
            )}
          </div>

          {isAssistant && isLatestAssistant && options.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {options.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onOptionClick?.(option)}
                  disabled={!onOptionClick}
                  className="rounded-full border border-primary/30 bg-background px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {option}
                </button>
              ))}
            </div>
          )}

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

        {/* Flag button — appears on group hover, assistant messages only */}
        {isAssistant && !flagged && !showReason && (
          <button
            onClick={() => setShowReason(true)}
            className="shrink-0 self-center rounded-full p-1.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-destructive"
            title="Flag as inaccurate"
          >
            <Flag className="size-3.5" />
          </button>
        )}

        {isAssistant && flagged && (
          <span
            className="shrink-0 self-center rounded-full p-1.5 text-amber-500"
            title="Flagged — admins will review this"
          >
            <Flag className="size-3.5" />
          </span>
        )}
      </div>

      {/* Source label — below the message row so it doesn't affect avatar alignment */}
      {sourceConfig && (
        <span className="pl-12 pt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <sourceConfig.icon className="size-3 shrink-0" />
          {sourceConfig.label(user?.organizationName)}
        </span>
      )}
    </div>
  );
}
