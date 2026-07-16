// Auth.js (NextAuth v5) configuration.
//
// Strategy: JWT sessions. There are NO Account/Session/VerificationToken tables
// in the Prisma schema, so the Prisma *adapter* is intentionally NOT wired up —
// the Credentials provider requires JWT sessions anyway. The JWT carries identity
// only (id / username / globalRole); authorisation truth lives in the DB and is
// re-checked on every server action (see `lib/permissions.ts`).

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { loginSchema } from "@/features/auth/schemas";

export const { auth, signIn, signOut, handlers } = NextAuth({
  // Node's env inference resolves AUTH_SECRET automatically; trustHost is required
  // when running behind the Foodverse reverse proxy / non-Vercel hosting.
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        // Never trust the raw credentials object — validate at the boundary.
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;
        const user = await prisma.user.findUnique({ where: { email } });

        // Reject if: no such user, not ACTIVE (INVITED / SUSPENDED), or SSO-only
        // account with no local password. Same null return for all of them so the
        // client can't distinguish "wrong password" from "no such user".
        if (!user || user.status !== "ACTIVE" || !user.hashedPassword) {
          return null;
        }

        const ok = await bcrypt.compare(password, user.hashedPassword);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          username: user.username,
          globalRole: user.globalRole,
        };
      },
    }),
  ],
  callbacks: {
    // Runs on sign-in (`user` present) and on every subsequent request.
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id!;
        token.username = user.username;
        token.globalRole = user.globalRole;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.username = token.username;
        session.user.globalRole = token.globalRole;
      }
      return session;
    },
  },
});
