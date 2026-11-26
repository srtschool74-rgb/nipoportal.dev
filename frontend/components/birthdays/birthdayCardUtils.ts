/**
 * Utility functions for serializing and parsing designed Birthday Cards
 * across in-app notifications, modals, and push payloads.
 */

export interface BirthdayCardPayload {
  recipientName: string;
  classNameLabel?: string;
  deityName: string;
  cardLine1: string;
  cardLine2: string;
  senderName: string;
  senderDesignation: string;
  schoolName: string;
  schoolLogo: string;
  schoolTagline?: string;
  ammanPhotoUrl: string;
  signatureUrl?: string;
  summaryText: string;
}

export const BIRTHDAY_CARD_PREFIX = "CARD_PAYLOAD:::";

/**
 * Serializes a birthday card payload into the notification content field.
 */
export function serializeBirthdayCardPayload(payload: BirthdayCardPayload): string {
  return `${BIRTHDAY_CARD_PREFIX}${JSON.stringify(payload)}`;
}

/**
 * Attempts to parse a birthday card payload from a notification content string.
 * Returns null if the content is not a card payload.
 */
export function parseBirthdayCardPayload(content?: string | null, title?: string | null): BirthdayCardPayload | null {
  if (!content && !title) return null;

  const trimmed = (content || "").trim();

  if (trimmed.startsWith(BIRTHDAY_CARD_PREFIX)) {
    try {
      return JSON.parse(trimmed.substring(BIRTHDAY_CARD_PREFIX.length));
    } catch {
      return null;
    }
  }

  // Fallback: check if content was saved as raw JSON
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed.recipientName === "string" && (parsed.deityName || parsed.cardLine1)) {
        return parsed as BirthdayCardPayload;
      }
    } catch {
      return null;
    }
  }

  // Auto-detect plain-text birthday notifications and synthesize the official designed card
  const titleStr = title || "";
  const isBirthday = /birthday/i.test(titleStr) || /happy birthday/i.test(trimmed);

  if (isBirthday) {
    let recipientName = "Student";
    const nameMatch = titleStr.match(/Happy Birthday,?\s*([^!🎂🎉\n]+)/i) ||
                      trimmed.match(/wishes\s+([A-Za-z0-9\s]+?)\s+a\s+very\s+happy/i);
    if (nameMatch && nameMatch[1]) {
      recipientName = nameMatch[1].trim();
    }

    return {
      recipientName,
      classNameLabel: undefined,
      deityName: "Amman",
      cardLine1: "I have great pleasure in conveying my best wishes on the eve of your birthday",
      cardLine2: "My prayers are to Amman to bless you with peace, prosperity and happiness",
      senderName: "PRANAV.J",
      senderDesignation: "Correspondent",
      schoolName: "SRT SCHOOL",
      schoolLogo: "/logo/srt-logo.svg",
      schoolTagline: "UNIVERSAL SCHOOL",
      ammanPhotoUrl: "/assets/birthday/amman.jpg",
      summaryText: trimmed || `Happy Birthday ${recipientName}!`,
    };
  }

  return null;
}

/**
 * Builds a friendly plain-text summary fallback for push notifications and SMS.
 */
export function buildBirthdaySummaryText(params: {
  recipientName: string;
  senderName?: string;
  senderDesignation?: string;
  schoolName?: string;
  deityName?: string;
}): string {
  const deity = params.deityName || "Amman";
  const sender = params.senderName || "PRANAV.J";
  const desig = params.senderDesignation || "Correspondent";
  const school = params.schoolName || "SRT SCHOOL";

  return `Happy Birthday ${params.recipientName}! May ${deity} bless you with peace, prosperity, and happiness. - ${sender}, ${desig}, ${school}`;
}

/**
 * Returns a clean, human-readable display string for notification content,
 * automatically decoding serialized birthday card payloads into friendly summaries.
 */
export function getNotificationDisplayText(content?: string | null): string {
  if (!content) return "";
  const card = parseBirthdayCardPayload(content);
  if (card) {
    if (card.summaryText) return card.summaryText;
    return buildBirthdaySummaryText(card);
  }
  return content;
}

