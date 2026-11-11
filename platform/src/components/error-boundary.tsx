"use client";

import React from "react";
import { RotateCcw, ShieldAlert } from "lucide-react";
import { reportClientError } from "@/selfHealingAgent";

type Props = { children: React.ReactNode };
type State = { failed: boolean };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    reportClientError(error.name, error.message);
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="error-screen">
          <section className="panel w-full max-w-lg p-8 text-center">
            <ShieldAlert className="mx-auto mb-4 text-[var(--danger)]" size={38} />
            <h1 className="text-xl font-bold">This screen needs a fresh start</h1>
            <p className="muted mt-2 text-sm">Your saved billing data is unchanged. Reload this workspace to recover.</p>
            <button className="button button-primary mt-6" onClick={() => window.location.reload()}>
              <RotateCcw size={16} /> Reload workspace
            </button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}
