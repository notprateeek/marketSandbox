import { PrismaAdapter } from '@auth/prisma-adapter';
import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/lib/password';
import { credentialsSchema } from '@/lib/validation/auth';

declare module 'next-auth' {
  interface Session {
    user: DefaultSession['user'] & { id: string };
  }
}

export const { auth, signIn, signOut, handlers } = NextAuth({
  adapter: PrismaAdapter(prisma as unknown as Parameters<typeof PrismaAdapter>[0]),
  session: { strategy: 'jwt' },
  pages: { signIn: '/sign-in' },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
          select: {
            id: true,
            name: true,
            email: true,
            emailVerified: true,
            image: true,
            passwordHash: true,
          },
        });

        if (
          !user?.passwordHash ||
          !(await verifyPassword(parsed.data.password, user.passwordHash))
        ) {
          return null;
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
          image: user.image,
        };
      },
    }),
  ],
  callbacks: {
    session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
