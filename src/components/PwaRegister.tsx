"use client";

import { useEffect } from "react";

/**
 * Registers the service worker so the app is installable (§9.4).
 * Registration is deferred to idle time so it never competes with first paint.
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return; // avoid stale caches in dev

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("[pwa] service worker registration failed", err);
      });
    };

    if ("requestIdleCallback" in window) {
      (window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(
        register,
      );
    } else {
      setTimeout(register, 2500);
    }
  }, []);

  return null;
}
