'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import {
  requestPasswordResetAction,
  resetPasswordAction,
  signInAction,
  signUpAction,
} from '@/app/actions/auth';
import type {
  AuthActionState,
  ResetPasswordState,
  ResetRequestState,
} from '@/app/actions/auth';

const inputClassName =
  'mt-2 w-full rounded-sm border border-hairline bg-canvas px-3.5 py-3 text-primary placeholder:text-muted/80 transition-colors hover:border-slate focus:border-focus-blue';

const initialState: AuthActionState = {};

export function SignInForm({ initialError }: { initialError?: string }) {
  const [state, action, pending] = useActionState(signInAction, initialState);
  const formError = state.formError ?? initialError;

  return (
    <form action={action} className="mt-8 space-y-5">
      <input type="hidden" name="redirectTo" value="/" />

      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        errors={state.fieldErrors?.email}
      />
      <div>
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          errors={state.fieldErrors?.password}
        />
        <div className="mt-2 flex justify-end">
          <Link
            href="/forgot-password"
            className="text-sm font-medium text-action-blue underline-offset-4 hover:underline"
          >
            Forgot password?
          </Link>
        </div>
      </div>

      <FormError message={formError} />

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-pill bg-primary px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-cohere-black disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

export function SignUpForm({ initialError }: { initialError?: string }) {
  const [state, action, pending] = useActionState(signUpAction, initialState);
  const formError = state.formError ?? initialError;

  return (
    <form action={action} className="mt-8 space-y-5">
      <input type="hidden" name="redirectTo" value="/" />

      <Field
        label="Name"
        name="name"
        type="text"
        autoComplete="name"
        errors={state.fieldErrors?.name}
      />
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        errors={state.fieldErrors?.email}
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        errors={state.fieldErrors?.password}
        hint="Use at least 8 characters."
        minLength={8}
      />

      <FormError message={formError} />

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-pill bg-primary px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-cohere-black disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<ResetRequestState, FormData>(
    requestPasswordResetAction,
    {},
  );

  return (
    <form action={action} className="mt-8 space-y-5">
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        errors={state.fieldErrors?.email}
      />

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-pill bg-primary px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-cohere-black disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? 'Sending…' : 'Send reset link'}
      </button>

      {state.submitted ? (
        state.resetPath ? (
          <div className="rounded-sm border border-action-blue/30 bg-pale-blue/40 px-3.5 py-3 text-sm">
            <p className="font-medium text-primary">Demo mode — no email is sent.</p>
            <p className="mt-1 text-body-muted">
              Normally you&apos;d get this by email. Use your reset link:
            </p>
            <Link
              href={state.resetPath}
              className="mt-2 inline-block font-medium text-action-blue underline-offset-4 hover:underline"
            >
              Set a new password →
            </Link>
          </div>
        ) : (
          <p className="rounded-sm border border-hairline bg-soft-stone/40 px-3.5 py-3 text-sm text-body-muted">
            If an account exists for that email, a reset link has been created.
          </p>
        )
      ) : null}
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<ResetPasswordState, FormData>(
    resetPasswordAction,
    {},
  );

  return (
    <form action={action} className="mt-8 space-y-5">
      <input type="hidden" name="token" value={token} />

      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        errors={state.fieldErrors?.password}
        hint="Use at least 8 characters."
        minLength={8}
      />

      <FormError message={state.formError} />

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-pill bg-primary px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-cohere-black disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Set new password'}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  type,
  autoComplete,
  errors,
  hint,
  minLength,
}: {
  label: string;
  name: 'name' | 'email' | 'password';
  type: 'text' | 'email' | 'password';
  autoComplete: string;
  errors?: string[];
  hint?: string;
  minLength?: number;
}) {
  const hintId = hint ? `${name}-hint` : undefined;
  const errorId = errors?.length ? `${name}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div>
      <label htmlFor={name} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        minLength={minLength}
        aria-invalid={Boolean(errors?.length)}
        aria-describedby={describedBy}
        className={inputClassName}
      />
      {hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {errors?.length ? (
        <ul id={errorId} className="mt-1.5 space-y-1 text-sm text-loss" aria-live="polite">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FormError({ message }: { message?: string }) {
  return message ? (
    <p
      role="alert"
      className="rounded-sm border border-loss/25 bg-loss/5 px-3.5 py-3 text-sm text-loss"
    >
      {message}
    </p>
  ) : null;
}
