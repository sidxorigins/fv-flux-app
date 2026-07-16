// Module augmentation — teaches Auth.js about Flux's extra identity fields.
//
// The JWT authenticates *identity only* (id / username / globalRole). It is NOT
// the source of truth for authorisation: every server-side permission helper in
// `lib/permissions.ts` re-fetches the user from the DB and re-checks status, so a
// suspended user is locked out immediately regardless of a still-valid JWT.

import type { DefaultSession } from "next-auth";
import type { GlobalRole } from "@/generated/prisma/enums";

declare module "next-auth" {
  /** Shape returned from `authorize()` and passed into the `jwt` callback. */
  interface User {
    username: string;
    globalRole: GlobalRole;
  }

  interface Session {
    user: {
      id: string;
      username: string;
      globalRole: GlobalRole;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    username: string;
    globalRole: GlobalRole;
  }
}
