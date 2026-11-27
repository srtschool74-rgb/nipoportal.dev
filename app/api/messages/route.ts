export const dynamic = "force-dynamic";

import { NextResponse, after } from "next/server";
import { getServerSession } from "next-auth/next";
import { getAuthOptions } from "@/backend/auth/authOptions";
import { prisma } from "@/backend/db/prisma";
import { NotificationService } from "@/backend/services/notifications/NotificationService";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(getAuthOptions());
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { 
      receiverId, 
      content, 
      messageType = "TEXT", 
      fileUrl = null, 
      fileName = null, 
      fileSize = null, 
      fileType = null, 
      duration = null,
      clientTempId = null,
      clientMessageId = null,
      attachmentId = null,
      attachmentIds = []
    } = body;

    const effectiveClientMessageId = clientMessageId || clientTempId || null;

    if (!receiverId) {
      return NextResponse.json({ error: "Receiver ID is required" }, { status: 400 });
    }

    // 1. Idempotency Check: if client sent clientMessageId, check if already exists
    if (effectiveClientMessageId) {
      const existingByClient = await prisma.message.findFirst({
        where: {
          senderId: session.user.id,
          clientMessageId: effectiveClientMessageId,
        },
        select: {
          id: true,
          clientMessageId: true,
          content: true,
          senderId: true,
          receiverId: true,
          status: true,
          isRead: true,
          isDeleted: true,
          messageType: true,
          fileUrl: true,
          fileName: true,
          fileSize: true,
          fileType: true,
          duration: true,
          editedAt: true,
          deliveredAt: true,
          readAt: true,
          createdAt: true,
        }
      });

      if (existingByClient) {
        return NextResponse.json({
          success: true,
          message: existingByClient,
          clientTempId: effectiveClientMessageId,
        });
      }
    }

    let effectiveFileUrl = fileUrl;
    let effectiveFileName = fileName;
    let effectiveFileSize = fileSize;
    let effectiveFileType = fileType;
    let effectiveMessageType = messageType;

    const allAttachmentIds: string[] = [
      ...(attachmentId ? [attachmentId] : []),
      ...(Array.isArray(attachmentIds) ? attachmentIds : [])
    ];

    if (allAttachmentIds.length > 0) {
      const firstAtt = await prisma.attachment.findUnique({
        where: { id: allAttachmentIds[0] }
      });
      if (firstAtt) {
        // Guarantee clean, lightweight HTTP URL (bypasses CloudFront payload limits)
        if (firstAtt.url.startsWith("http://") || firstAtt.url.startsWith("https://")) {
          effectiveFileUrl = firstAtt.url;
        } else {
          effectiveFileUrl = `/api/uploads/file/${firstAtt.id}`;
        }
        effectiveFileName = firstAtt.fileName;
        effectiveFileSize = firstAtt.fileSize;
        effectiveFileType = firstAtt.fileType;
        if (effectiveMessageType === "TEXT") {
          effectiveMessageType = firstAtt.fileType.startsWith("image/") ? "IMAGE" : "FILE";
        }
      }
    } else if (effectiveFileUrl && effectiveFileUrl.startsWith("data:") && attachmentId) {
      effectiveFileUrl = `/api/uploads/file/${attachmentId}`;
    }

    const cleanContent = (content || "").trim();
    if (!cleanContent && !effectiveFileUrl && effectiveMessageType === "TEXT") {
      return NextResponse.json({ error: "Message content or attachment is required" }, { status: 400 });
    }

    // Resolve recipient user ID (handling direct User.id, Parent.id, or Teacher.id)
    let targetReceiverId = receiverId;
    let receiver = await prisma.user.findUnique({
      where: { id: targetReceiverId },
      select: { id: true, role: true, name: true }
    });

    if (!receiver) {
      const parentRecord = await prisma.parent.findUnique({
        where: { id: receiverId },
        select: { userId: true, user: { select: { id: true, role: true, name: true } } }
      });
      if (parentRecord?.user) {
        receiver = parentRecord.user;
        targetReceiverId = parentRecord.userId;
      }
    }

    if (!receiver) {
      const teacherRecord = await prisma.teacher.findUnique({
        where: { id: receiverId },
        select: { userId: true, user: { select: { id: true, role: true, name: true } } }
      });
      if (teacherRecord?.user) {
        receiver = teacherRecord.user;
        targetReceiverId = teacherRecord.userId;
      }
    }

    if (!receiver) {
      return NextResponse.json({ error: "Recipient not found" }, { status: 404 });
    }

    // Permission enforcement: Admins can only message teachers and parents
    if (session.user.role === "ADMIN" && receiver.role !== "TEACHER" && receiver.role !== "PARENT") {
      return NextResponse.json({ error: "Admins can only message teachers and parents." }, { status: 403 });
    }

    const finalContent = cleanContent || (
      effectiveMessageType === "AUDIO" 
        ? "🎤 Voice message" 
        : effectiveMessageType === "IMAGE"
          ? "Sent an image"
          : effectiveFileName 
            ? `📎 ${effectiveFileName}` 
            : "Attachment"
    );

    // 2. Fast Save in Database (<50ms) with clientMessageId and status "sent"
    const message = await prisma.message.create({
      data: {
        senderId: session.user.id,
        receiverId: targetReceiverId,
        content: finalContent,
        messageType: effectiveMessageType,
        fileUrl: effectiveFileUrl,
        fileName: effectiveFileName,
        fileSize: effectiveFileSize,
        fileType: effectiveFileType,
        duration,
        clientMessageId: effectiveClientMessageId,
        status: "sent",
        isRead: false,
      },
      select: {
        id: true,
        clientMessageId: true,
        content: true,
        senderId: true,
        receiverId: true,
        status: true,
        isRead: true,
        isDeleted: true,
        messageType: true,
        fileUrl: true,
        fileName: true,
        fileSize: true,
        fileType: true,
        duration: true,
        editedAt: true,
        deliveredAt: true,
        readAt: true,
        createdAt: true,
      }
    });

    // 3. Link attachments asynchronously
    if (allAttachmentIds.length > 0) {
      prisma.attachment.updateMany({
        where: { id: { in: allAttachmentIds } },
        data: { messageId: message.id, status: "READY" },
      }).catch((attErr) => console.warn("[Messages] Attachment link note:", attErr));
    }

    // 4. Background Notification Dispatch (UNBLOCKING: does not hold up response)
    const notifPromise = (async () => {
      try {
        let recipientLink = `/dashboard/parent/messages/${session.user.id}`;
        if (receiver.role === "TEACHER") {
          recipientLink = `/dashboard/teacher/messages/${session.user.id}`;
        } else if (receiver.role === "ADMIN") {
          recipientLink = `/dashboard/admin/messages/${session.user.id}`;
        }

        const senderDisplayName = session.user.name || "SRT School";
        const senderRoleLabel = session.user.role === "ADMIN" 
          ? "School Administration" 
          : session.user.role === "TEACHER" 
            ? "Faculty Teacher" 
            : "Parent";

        let notifTitle = `💬 Message from ${senderDisplayName} (${senderRoleLabel})`;
        let notifBody = cleanContent;
        let notifImage: string | undefined = undefined;

        if (effectiveMessageType === "IMAGE" || (effectiveFileType && effectiveFileType.startsWith("image/"))) {
          notifTitle = `📷 Photo from ${senderDisplayName}`;
          notifBody = cleanContent ? `Photo: "${cleanContent}"` : "Sent a photo";
          if (effectiveFileUrl && !effectiveFileUrl.startsWith("data:")) {
            notifImage = effectiveFileUrl;
          }
        } else if (effectiveMessageType === "AUDIO") {
          notifTitle = `🎤 Voice message from ${senderDisplayName}`;
          notifBody = "Sent a voice message";
        } else if (effectiveMessageType === "FILE" || effectiveFileUrl) {
          notifTitle = `📎 File from ${senderDisplayName}`;
          notifBody = `Sent a file: ${effectiveFileName || "attachment"}${cleanContent ? ` - "${cleanContent}"` : ""}`;
        } else if (cleanContent.length > 100) {
          notifBody = cleanContent.slice(0, 97) + "...";
        }

        await NotificationService.send({
          recipients: [targetReceiverId],
          type: "MESSAGE",
          category: "MESSAGE",
          title: notifTitle,
          body: notifBody || `New message from ${senderDisplayName}`,
          link: recipientLink,
          image: notifImage,
          dedupeKey: `chat-msg-${message.id}`,
          priority: "HIGH",
          data: {
            messageId: message.id,
            senderId: session.user.id,
            conversationWith: session.user.id,
            url: recipientLink,
          },
        });
      } catch (notifErr) {
        console.error("[Messages] Background notification error:", notifErr);
      }
    })();

    // Schedule with Next.js after() so Vercel serverless keeps the function alive until push completes
    after(async () => {
      await notifPromise;
    });

    // 5. Instantly return 200 OK (<100ms) with message and clientTempId
    return NextResponse.json({
      success: true,
      message,
      clientTempId: effectiveClientMessageId,
    });
  } catch (error) {
    const e = error as Error;
    console.error("POST /api/messages error:", e);
    return NextResponse.json({ error: e.message || "Failed to send message" }, { status: 500 });
  }
}
