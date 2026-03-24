"use client";

import { type KeyboardEvent, useEffect, useRef } from "react";
import { Send, Mic, Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { VoiceInputState } from "../hooks/useVoiceInput";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  mode: "text" | "voice";
  voiceState: VoiceInputState;
  isVoiceSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
  // Voice mode controls
  isSpeaking: boolean;
  voicePaused: boolean;
  onStopVoice: () => void;
  onStartVoice: () => void;
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  isLoading,
  mode,
  voiceState,
  isVoiceSupported,
  startListening,
  stopListening,
  isSpeaking,
  voicePaused,
  onStopVoice,
  onStartVoice,
}: ChatInputProps) {

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isLoading && mode === "text") {
      textareaRef.current?.focus();
    }
  }, [isLoading, mode]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isLoading && value?.trim()) {
        onSubmit();
      }
    }
  };

  // Voice mode: single large button — red stop when loop is running, blue mic when paused
  if (mode === "voice") {
    const loopRunning = !voicePaused;
    const isProcessing = voiceState === "transcribing" || isLoading;

    const statusText = isSpeaking
      ? "Speaking..."
      : voiceState === "recording"
      ? "Listening..."
      : isProcessing
      ? "Processing..."
      : loopRunning
      ? "Listening..."
      : "Tap to speak";

    return (
      <div className="shrink-0 border-t bg-background px-4 py-6">
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-muted-foreground">{statusText}</p>
          <div className="relative flex items-center justify-center">
            {loopRunning && !isProcessing && (
              <>
                <span className="absolute inline-flex h-16 w-16 rounded-full bg-blue-400 opacity-40 animate-ping" />
                <span className="absolute inline-flex h-16 w-16 rounded-full bg-blue-400 opacity-20 animate-ping [animation-delay:0.4s]" />
              </>
            )}
            <Button
              type="button"
              size="icon"
              variant="default"
              className={`relative h-16 w-16 rounded-full ${loopRunning ? "bg-blue-500 hover:bg-blue-600" : ""}`}
              onClick={loopRunning ? onStopVoice : onStartVoice}
              disabled={isProcessing}
              aria-label={loopRunning ? "Stop" : "Start speaking"}
            >
              {isProcessing ? (
                <Loader2 className="size-6 animate-spin" />
              ) : loopRunning ? (
                <Square className="size-6 fill-current" />
              ) : (
                <Mic className="size-6" />
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Text mode: textarea + optional mic toggle + send button
  return (
    <div className="shrink-0 border-t bg-background px-3 py-2 sm:px-4 sm:py-3">
      <div className="flex items-center gap-1.5 sm:gap-2">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            voiceState === "recording"
              ? "Listening..."
              : "Message..."
          }
          rows={1}
          className="min-h-10 sm:min-h-9 max-h-36 resize-none"
          disabled={isLoading}
        />
        {isVoiceSupported && (
          <div className="relative flex items-center justify-center shrink-0">
            {(voiceState === "recording" || voiceState === "transcribing") && (
              <>
                <span className="absolute inline-flex h-10 w-10 rounded-full bg-blue-400 opacity-40 animate-ping" />
                <span className="absolute inline-flex h-10 w-10 rounded-full bg-blue-400 opacity-20 animate-ping [animation-delay:0.4s]" />
              </>
            )}
            <Button
              type="button"
              variant={voiceState === "recording" || voiceState === "transcribing" ? "default" : "outline"}
              size="sm"
              className={`relative h-10 w-10 ${voiceState === "recording" || voiceState === "transcribing" ? "bg-blue-500 hover:bg-blue-600" : ""}`}
              onClick={voiceState === "recording" ? stopListening : startListening}
              disabled={voiceState === "transcribing"}
              aria-label={voiceState === "recording" ? "Stop listening" : "Start voice input"}
            >
              <Mic className="size-4 sm:size-5" />
            </Button>
          </div>
        )}
        <Button
          type="button"
          size="sm"
          className="shrink-0 h-10 w-10"
          onClick={onSubmit}
          disabled={isLoading || !value?.trim()}
          aria-label="Send message"
        >
          <Send className="size-4 sm:size-5" />
        </Button>
      </div>
    </div>
  );
}
