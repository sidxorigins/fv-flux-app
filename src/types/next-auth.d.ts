// Module augmentation — teaches Auth.js about Flux's extra identity fields.
//
// The JWT authenticates *identity only* (id / username / globalRole / pwdAt). It
// is NOT the source of truth for authorisation: every server-side permission
// helper in `lib/permissions.ts` re-fetches the user from the DB and re-checks
// status, so a suspended user is locked out immediately regardless of a
// still-valid JWT. `pwdAt` is a password-change watermark (epoch ms) carried
// alongside identity: `requireUser` compares it against the user's current
// `passwordChangedAt` so a password reset ends every session issued before it.

import type { DefaultSession } from "next-auth";
import type { GlobalRole } from "@/generated/prisma/enums";

declare module "next-auth" {
  /** Shape returned from `authorize()` and passed into the `jwt` callback. */
  interface User {
    username: string;
    globalRole: GlobalRole;
    /** Epoch ms of the user's last password change (0 if never). */
    pwdAt: number;
  }

  interface Session {
    user: {
      id: string;
      username: string;
      globalRole: GlobalRole;
      pwdAt: number;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    username: string;
    globalRole: GlobalRole;
    pwdAt: number;
  }
}
