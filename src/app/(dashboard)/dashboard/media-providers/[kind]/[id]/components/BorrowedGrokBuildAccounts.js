"use client";

import Link from "next/link";
import { Card, Badge } from "@/shared/components";

export function BorrowedGrokBuildAccounts({ accounts = [] }) {
  if (!accounts.length) return null;

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-lg font-semibold">Grok Build</h2>
          <p className="text-xs text-text-muted mt-0.5">
            Read-only. Manage this login under Providers → Grok CLI.
          </p>
        </div>
        <Link
          href="/dashboard/providers/grok-cli"
          className="text-xs text-primary hover:underline shrink-0"
        >
          Manage in Grok CLI
        </Link>
      </div>
      <div className="flex flex-col gap-2">
        {accounts.map((account) => (
          <div
            key={account.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">
                {account.email || account.displayName || account.name}
              </p>
              {account.email && account.name && account.email !== account.name && (
                <p className="text-xs text-text-muted truncate">{account.name}</p>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Badge variant="default" size="sm">Grok Build</Badge>
              {account.tierRestricted && (
                <Badge variant="warning" size="sm">Imagine not included</Badge>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
