"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator && window.location.protocol === "https:") {
      void navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
        console.error("Service worker registration failed", error);
      });
    }
  }, []);
  return null;
}
