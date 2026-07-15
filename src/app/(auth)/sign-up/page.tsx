import type { Metadata } from 'next';
import Link from 'next/link';
import { SignUpForm } from '@/components/auth/AuthForms';

export const metadata: Metadata = {
  title: 'Create account',
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const error = (await searchParams).error;
  const initialError = error ? 'We could not create your account. Please try again.' : undefined;

  return (
    <>
      <p className="text-mono-label text-muted">Start with ₹50,000 virtual cash</p>
      <h1 className="mt-3 font-display text-4xl tracking-tight text-primary">
        Create your account
      </h1>
      <p className="mt-3 text-body-muted">
        No real money, deposits, or brokerage account required.
      </p>

      <SignUpForm initialError={initialError} />

      <p className="mt-7 text-sm text-body-muted">
        Already have an account?{' '}
        <Link
          href="/sign-in"
          className="font-medium text-action-blue underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}
