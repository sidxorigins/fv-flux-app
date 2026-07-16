// Auth Zod schemas — the single source of truth reused on client and server.
// Import these in react-hook-form resolvers AND in every Server Action / route
// handler that touches auth. Never re-validate ad hoc.

import { z } from "zod";

// System handles that must never be claimed by a user.
const RESERVED_USERNAMES = new Set([
  "admin",
  "api",
  "support",
  "system",
  "root",
  "flux",
  "foodverse",
  "help",
  "security",
  "noreply",
]);

/**
 * Username: 3–30 chars, lowercase `[a-z0-9_]`, no leading/trailing underscore,
 * not reserved. Input is trimmed + lowercased BEFORE validation so mixed-case
 * input normalises rather than being rejected — the DB stores the lowercased
 * form and enforces a case-insensitive unique index on it.
 */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Username must be at least 3 characters")
  .max(30, "Username must be at most 30 characters")
  .regex(
    /^[a-z0-9_]+$/,
    "Username may only contain lowercase letters, numbers, and underscores",
  )
  .refine(
    (v) => !v.startsWith("_") && !v.endsWith("_"),
    "Username can't start or end with an underscore",
  )
  .refine((v) => !RESERVED_USERNAMES.has(v), "That username is reserved");

/** Email — trimmed + lowercased so it matches the lowercased value stored in the DB. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address").max(254));

/**
 * Password policy: at least 10 chars with at least one letter and one digit.
 * Only enforced when *setting* a password (register / set-password) — login
 * must not reveal the policy, so `loginSchema` uses a bare non-empty check.
 */
export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(200, "Password must be at most 200 characters")
  .regex(/[A-Za-z]/, "Password must contain at least one letter")
  .regex(/[0-9]/, "Password must contain at least one number");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

export const registerSchema = z.object({
  token: z.string().min(1, "Missing invite token"),
  name: z.string().trim().min(1, "Name is required").max(80),
  username: usernameSchema,
  password: passwordSchema,
});

export const setPasswordSchema = z.object({
  token: z.string().min(1, "Missing token"),
  password: passwordSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;
