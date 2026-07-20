import type { Metadata } from 'next';
import Link from 'next/link';
import { ResetPasswordForm } from '@/components/auth/AuthForms';

export const metadata: Metadata = {
  title: 'Set a new password',
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <>
        <p className="text-mono-label text-muted">Reset password</p>
        <h1 className="mt-3 font-display text-4xl tracking-tight text-primary">
          This link is incomplete
        </h1>
        <p className="mt-3 text-body-muted">
          The reset link is missing its token. Request a new one to continue.
        </p>
        <Link
          href="/forgot-password"
          className="mt-8 inline-block rounded-pill bg-primary px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-cohere-black"
        >
          Request a new link
        </Link>
      </>
    );
  }

  return (
    <>
      <p className="text-mono-label text-muted">Almost there</p>
      <h1 className="mt-3 font-display text-4xl tracking-tight text-primary">Set a new password</h1>
      <p className="mt-3 text-body-muted">Choose a new password for your account.</p>

      <ResetPasswordForm token={token} />

      <p className="mt-7 text-sm text-body-muted">
        <Link
          href="/sign-in"
          className="font-medium text-action-blue underline-offset-4 hover:underline"
        >
          Back to sign in
        </Link>
      </p>
    </>
  );
}
