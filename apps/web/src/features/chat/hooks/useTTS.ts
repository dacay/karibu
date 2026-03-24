"use client";

import { useCallback, useRef, useState } from "react";
import { TTS_ENDPOINT } from "../constants";

export type TTSState = "idle" | "loading" | "playing" | "error";

export interface UseTTSReturn {
  state: TTSState;
  isSpeaking: boolean;
  speak: (text: string, voiceId?: string) => Promise<void>;
  stop: () => void;
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("karibu_token");
}

export function useTTS(): UseTTSReturn {

  const [state, setState] = useState<TTSState>("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cleanup = useCallback(() => {
    if (abortRef.current) {

      abortRef.current.abort();
      abortRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    cleanup();
    setState("idle");
  }, [cleanup]);

  const speak = useCallback(async (text: string, voiceId?: string) => {

    stop();
    setState("loading");

    const plain = text
      .replace(/#{1,6}\s+/g, "")           // headings
      .replace(/\*\*(.+?)\*\*/g, "$1")     // bold
      .replace(/\*(.+?)\*/g, "$1")         // italic
      .replace(/~~(.+?)~~/g, "$1")         // strikethrough
      .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")  // inline code / code blocks → keep content
      .replace(/^\s*[-*+]\s+/gm, "")       // unordered list markers
      .replace(/^\s*\d+\.\s+/gm, "")       // ordered list markers
      .replace(/\[(.+?)\]\(.+?\)/g, "$1")  // links → label only
      .replace(/!?\[.*?\]\(.*?\)/g, "")    // images
      .replace(/^[-*_]{3,}$/gm, "")        // horizontal rules
      .replace(/\n{2,}/g, " ")             // collapse extra newlines
      .trim();

    const controller = new AbortController();
    abortRef.current = controller;

    try {

      const token = getToken();

      const res = await fetch(TTS_ENDPOINT, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text: plain, voiceId }),
      });

      if (!res.ok) {
        throw new Error(`TTS failed: ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;

      const audio = new Audio(url);
      audioRef.current = audio;

      await new Promise<void>((resolve, reject) => {
        audio.onended = () => {
          cleanup();
          setState("idle");
          resolve();
        };
        audio.onerror = () => {
          cleanup();
          setState("error");
          reject(new Error("Audio playback failed"));
        };
        setState("playing");
        audio.play().catch(reject);
      });

    } catch (err) {

      if (err instanceof Error && err.name === "AbortError") return;

      cleanup();
      setState("error");
    }

  }, [stop, cleanup]);

  return { state, isSpeaking: state === "playing", speak, stop };
}
