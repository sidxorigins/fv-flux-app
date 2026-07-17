// Authorised image/file serve route. Inline comment images are stored in HTML as
// `<img src="/api/files/<attachmentId>">`; an <img> can't call a Server Action,
// so this is the sanctioned GET endpoint (CLAUDE.md). It keeps the bucket private:
// it authorises the caller (VIEWER on the attachment's project), then 302s to a
// short-lived presigned GET — bytes never pass through the app server, and the R2
// key is never exposed to the client.
//
// `?download=1` forces Content-Disposition: attachment (the file-list download
// affordance); default is inline (so images render in the comment body).

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { AuthorizationError, requireProjectRole } from "@/lib/permissions";
import { presignDownloadUrl } from "@/lib/r2";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id || !/^[A-Za-z0-9]+$/.test(id)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const url = new URL(_request.url);
  const forceDownload = url.searchParams.get("download") === "1";

  try {
    const attachment = await prisma.attachment.findUnique({
      where: { id },
      select: {
        key: true,
        filename: true,
        task: { select: { projectId: true } },
      },
    });
    if (!attachment) return new NextResponse("Not found", { status: 404 });

    // Read access to the file's project is required on every request.
    await requireProjectRole(attachment.task.projectId, "VIEWER");

    const presigned = await presignDownloadUrl(
      attachment.key,
      forceDownload ? attachment.filename : undefined,
    );

    // 302 to the presigned URL. `private, no-store` keeps the redirect itself out
    // of shared caches (the target URL is short-lived and per-user authorised).
    return NextResponse.redirect(presigned, {
      status: 302,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    if (err instanceof AuthorizationError) {
      const status = err.code === "UNAUTHENTICATED" ? 401 : 403;
      return new NextResponse(
        status === 401 ? "Unauthorized" : "Forbidden",
        { status },
      );
    }
    return new NextResponse("Server error", { status: 500 });
  }
}
