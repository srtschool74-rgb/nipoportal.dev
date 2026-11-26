/**
 * Central Session & Device Configuration
 * Configures Single-Device Enforcement and Persistent Login rules.
 * Indefinite Session Persistence: users remain authenticated permanently
 * until explicit logout or admin revocation.
 */

// Enforce 1 phone/device active at a time for Parents and Teachers by default
export const SINGLE_DEVICE_ROLES: readonly string[] = ["PARENT", "TEACHER"];

// 10 Years (87,600 hours) indefinite sliding idle persistence for permanent seamless logins (Parents & Teachers)
export const IDLE_TIMEOUT_HOURS = 87600;
export const INACTIVITY_LOGOUT_HOURS = 87600;

// Admin accounts default idle timeout: 7 days (168 hours), configurable in Admin Settings
export const DEFAULT_ADMIN_IDLE_TIMEOUT_HOURS = 168;

// Permanent session duration: null disables automatic session termination
export const MAX_SESSION_HOURS: number | null = null;

export const ACTIVITY_UPDATE_INTERVAL_MIN = 15;

export const STATUS_POLL_SECONDS = 60;

export type SessionRevocationReason =
  | "LOGIN_ELSEWHERE"
  | "IDLE_TIMEOUT"
  | "MAX_TIME"
  | "LOGOUT"
  | "PASSWORD_CHANGED"
  | "ADMIN_FORCED";

export const REVOCATION_MESSAGES: Record<SessionRevocationReason | string, string> = {
  LOGIN_ELSEWHERE: "You were logged out because your account was signed in on another device.",
  IDLE_TIMEOUT: "Session expired due to inactivity. Please log in again.",
  MAX_TIME: "Your session has reached its maximum allowed duration (7 days). Please log in again.",
  LOGOUT: "You have been signed out successfully.",
  PASSWORD_CHANGED: "Your password was changed. Please log in again with your new credentials.",
  ADMIN_FORCED: "Your session was ended by an administrator.",
};

