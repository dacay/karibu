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
        body: JSON.stringify({ text, voiceId }),
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
