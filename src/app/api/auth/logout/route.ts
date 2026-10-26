import { NextResponse } from "next/server";
import { endSession } from "@/server/auth";

export async function POST() {
  endSession();
  return NextResponse.json({ ok: true });
}
