import type { Metadata } from 'next';
import Link from 'next/link';
import { SignInForm } from '@/components/auth/AuthForms';

export const metadata: Metadata = {
  title: 'Sign in',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const error = (await searchParams).error;
  const initialError = error
    ? error === 'CredentialsSignin'
      ? 'The email or password is incorrect.'
      : 'We could not sign you in. Please try again.'
    : undefined;

  return (
    <>
      <p className="text-mono-label text-muted">Welcome back</p>
      <h1 className="mt-3 font-display text-4xl tracking-tight text-primary">
        Sign in to TradePlay
      </h1>
      <p className="mt-3 text-body-muted">Continue to your virtual trading account.</p>

      <SignInForm initialError={initialError} />

      <p className="mt-7 text-sm text-body-muted">
        New to TradePlay?{' '}
        <Link
          href="/sign-up"
          className="font-medium text-action-blue underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </>
  );
}
