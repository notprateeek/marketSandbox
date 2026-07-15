import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AppShell } from '@/components/layout/AppShell';

export default async function ProtectedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect('/sign-in');
  }

  return <AppShell>{children}</AppShell>;
}
