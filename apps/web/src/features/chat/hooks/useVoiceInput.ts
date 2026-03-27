"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TRANSCRIBE_ENDPOINT } from "../constants";

export type VoiceInputState = "idle" | "recording" | "transcribing";

export interface UseVoiceInputReturn {
  state: VoiceInputState;
  isSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
  /** Stop recording and discard audio without transcribing. */
  discardListening: () => void;
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("karibu_token");
}

// Silence detection thresholds
const SILENCE_THRESHOLD        = 8;    // RMS amplitude (0–128 scale)
const SILENCE_DURATION_INITIAL = 3000; // ms to wait before first word
const SILENCE_DURATION_AFTER   = 1000; // ms of silence after speech ends

export function useVoiceInput(
  onTranscript: (text: string) => void,
  onNoSpeech?: () => void,
): UseVoiceInputReturn {

  const [state, setState] = useState<VoiceInputState>("idle");

  // State ref so startListening can always read the latest state without
  // needing to be recreated (avoids stale closure issues).
  const stateRef          = useRef<VoiceInputState>("idle");
  const mediaRecorderRef  = useRef<MediaRecorder | null>(null);
  const chunksRef         = useRef<BlobPart[]>([]);
  const audioCtxRef       = useRef<AudioContext | null>(null);
  const silenceTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isStartingRef     = useRef(false);
  const speechDetectedRef = useRef(false);
  const discardRef        = useRef(false);
  const onTranscriptRef   = useRef(onTranscript);
  const onNoSpeechRef     = useRef(onNoSpeech);

  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onNoSpeechRef.current   = onNoSpeech;   }, [onNoSpeech]);

  const setVoiceState = useCallback((next: VoiceInputState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const isSupported =
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia);

  const cleanupAudio = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  const doStop = useCallback(() => {
    cleanupAudio();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }, [cleanupAudio]);

  // startListening reads stateRef instead of depending on state,
  // so it's stable and never stale.
  const startListening = useCallback(async () => {
    if (stateRef.current !== "idle" || isStartingRef.current) return;
    isStartingRef.current = true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      speechDetectedRef.current = false;
      discardRef.current = false;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        cleanupAudio();

        // Discarded (user hit stop) → drop audio, go idle
        if (discardRef.current) {
          setVoiceState("idle");
          return;
        }

        // No speech detected → notify parent so it can restart if appropriate
        if (!speechDetectedRef.current) {
          setVoiceState("idle");
          onNoSpeechRef.current?.();
          return;
        }

        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });

        setVoiceState("transcribing");

        try {
          const formData = new FormData();
          formData.append("audio", blob, "audio.webm");

          const token = getToken();
          const res = await fetch(TRANSCRIBE_ENDPOINT, {
            method: "POST",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData,
          });

          if (res.ok) {
            const data = (await res.json()) as { text?: string };
            if (data.text?.trim()) {
              onTranscriptRef.current(data.text.trim());
            }
          }
        } finally {
          setVoiceState("idle");
        }
      };

      // Silence detection via Web Audio API
      try {
        const audioCtx = new AudioContext();
        const source   = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        audioCtxRef.current = audioCtx;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const checkSilence = () => {
          if (!audioCtxRef.current || !mediaRecorderRef.current) return;
          if (mediaRecorderRef.current.state !== "recording") return;

          analyser.getByteTimeDomainData(dataArray);

          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += (dataArray[i] - 128) ** 2;
          }
          const rms = Math.sqrt(sum / dataArray.length);

          if (rms < SILENCE_THRESHOLD) {
            if (!silenceTimerRef.current) {
              const delay = speechDetectedRef.current
                ? SILENCE_DURATION_AFTER
                : SILENCE_DURATION_INITIAL;
              silenceTimerRef.current = setTimeout(() => {
                silenceTimerRef.current = null;
                if (mediaRecorderRef.current?.state === "recording") {
                  mediaRecorderRef.current.stop();
                }
              }, delay);
            }
          } else {
            speechDetectedRef.current = true;
            if (silenceTimerRef.current) {
              clearTimeout(silenceTimerRef.current);
              silenceTimerRef.current = null;
            }
          }

          requestAnimationFrame(checkSilence);
        };

        requestAnimationFrame(checkSilence);
      } catch {
        // Silence detection unavailable — manual stop only
      }

      recorder.start();
      mediaRecorderRef.current = recorder;
      setVoiceState("recording");

    } catch {
      setVoiceState("idle");
    } finally {
      isStartingRef.current = false;
    }
  }, [cleanupAudio, setVoiceState]);

  const stopListening = useCallback(() => {
    doStop();
  }, [doStop]);

  const discardListening = useCallback(() => {
    discardRef.current = true;
    doStop();
  }, [doStop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      doStop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, isSupported, startListening, stopListening, discardListening };
}
