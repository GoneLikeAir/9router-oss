"use client";

import Link from "next/link";
import { Card, Button } from "@/shared/components";

export function XaiMediaEmptyState({ kind }) {
  const label = kind === "video" ? "video" : "image";
  return (
    <Card>
      <div className="flex flex-col items-center text-center py-6 gap-3">
        <span className="material-symbols-outlined text-3xl text-text-muted">image</span>
        <div>
          <h2 className="text-lg font-semibold">Generate {label}s with Grok Imagine</h2>
          <p className="text-sm text-text-muted mt-1 max-w-md">
            Log in to Grok CLI (Grok Build) to use your subscription, or add an xAI API key.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
          <Link href="/dashboard/providers/grok-cli">
            <Button size="sm">Log in to Grok CLI (Grok Build)</Button>
          </Link>
          <Link href="/dashboard/providers/xai">
            <Button size="sm" variant="secondary">Add xAI API Key</Button>
          </Link>
        </div>
      </div>
    </Card>
  );
}
