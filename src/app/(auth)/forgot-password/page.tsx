import type { Metadata } from 'next';
import Link from 'next/link';
import { ForgotPasswordForm } from '@/components/auth/AuthForms';

export const metadata: Metadata = {
  title: 'Reset password',
};

export default function ForgotPasswordPage() {
  return (
    <>
      <p className="text-mono-label text-muted">Forgot your password?</p>
      <h1 className="mt-3 font-display text-4xl tracking-tight text-primary">
        Reset your password
      </h1>
      <p className="mt-3 text-body-muted">
        Enter the email for your account and we&apos;ll send a link to set a new password.
      </p>

      <ForgotPasswordForm />

      <p className="mt-7 text-sm text-body-muted">
        Remembered it?{' '}
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
