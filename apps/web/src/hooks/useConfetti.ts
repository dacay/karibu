import { useCallback } from "react";
import confetti from "canvas-confetti";

export function useConfetti() {
  const fire = useCallback(() => {
    const end = Date.now() + 3000;

    const colors = ["#a786ff", "#fd8bbc", "#eca184", "#f8deb1", "#6ee7b7", "#93c5fd"];

    (function frame() {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        startVelocity: 60,
        origin: { x: 0, y: 0.5 },
        colors,
      });

      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        startVelocity: 60,
        origin: { x: 1, y: 0.5 },
        colors,
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    })();
  }, []);

  return { fire };
}
