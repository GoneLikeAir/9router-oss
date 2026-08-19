import { NextResponse } from "next/server";
import { listXaiMediaAccounts } from "@/sse/services/xaiMediaCredentials.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/media-providers/accounts?kind=image|video&provider=xai
 * Structured media accounts for Imagine (true xai + borrowed grok-cli).
 * Never returns tokens. Must not be used to inflate Providers connection counts.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const kind = searchParams.get("kind") || "image";
    const provider = searchParams.get("provider") || "xai";

    if (provider !== "xai") {
      return NextResponse.json({ error: "Only provider=xai is supported" }, { status: 400 });
    }
    if (kind !== "image" && kind !== "video") {
      return NextResponse.json({ error: "kind must be image or video" }, { status: 400 });
    }

    const accounts = await listXaiMediaAccounts(kind);
    return NextResponse.json({ accounts });
  } catch (error) {
    console.log("Error listing media provider accounts:", error);
    return NextResponse.json({ error: "Failed to list media accounts" }, { status: 500 });
  }
}
