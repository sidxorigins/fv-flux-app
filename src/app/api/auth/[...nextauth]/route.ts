// Auth.js catch-all route handler. Exposes /api/auth/* (sign-in, callback,
// session, csrf, …). The real config lives in `lib/auth.ts`.
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
