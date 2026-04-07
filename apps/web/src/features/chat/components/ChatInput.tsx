"use client";

import { type KeyboardEvent } from "react";
import { Send, Mic, MicOff, Loader2, Square, Pause, Play } from "lucide-react";
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
  isPaused: boolean;
  onPauseSpeech: () => void;
  onResumeSpeech: () => void;
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
  isPaused,
  onPauseSpeech,
  onResumeSpeech,
  voicePaused,
  onStopVoice,
  onStartVoice,
}: ChatInputProps) {

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

    const statusText = isPaused
      ? "Paused"
      : isSpeaking
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
          <div className="flex items-center gap-3">
            {(isSpeaking || isPaused) && (
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-12 w-12 rounded-full"
                onClick={isPaused ? onResumeSpeech : onPauseSpeech}
                aria-label={isPaused ? "Resume speech" : "Pause speech"}
              >
                {isPaused ? (
                  <Play className="size-5" />
                ) : (
                  <Pause className="size-5" />
                )}
              </Button>
            )}
            <Button
              type="button"
              size="icon"
              variant={loopRunning ? "destructive" : "default"}
              className="h-16 w-16 rounded-full"
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
        {(isSpeaking || isPaused) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 h-10 w-10"
            onClick={isPaused ? onResumeSpeech : onPauseSpeech}
            aria-label={isPaused ? "Resume speech" : "Pause speech"}
          >
            {isPaused ? (
              <Play className="size-4 sm:size-5" />
            ) : (
              <Pause className="size-4 sm:size-5" />
            )}
          </Button>
        )}
        <Textarea
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
          <Button
            type="button"
            variant={voiceState === "recording" ? "destructive" : "outline"}
            size="sm"
            className="shrink-0 h-10 w-10"
            onClick={voiceState === "recording" ? stopListening : startListening}
            disabled={voiceState === "transcribing"}
            aria-label={voiceState === "recording" ? "Stop listening" : "Start voice input"}
          >
            {voiceState === "recording" ? (
              <MicOff className="size-4 sm:size-5" />
            ) : (
              <Mic className="size-4 sm:size-5" />
            )}
          </Button>
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
