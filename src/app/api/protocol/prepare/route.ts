import { boundedJson } from "@/lib/request-body";
import { safeError } from "@/lib/protocol/errors";
import { NextResponse } from "next/server";
import { actionSchema, prepareAction } from "@/lib/protocol/prepare";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    return NextResponse.json(
      await prepareAction(actionSchema.parse(await boundedJson(request))),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: safeError(error, "Unable to prepare transaction."),
      },
      { status: 400 },
    );
  }
}
