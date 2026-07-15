'use client';

import { useActionState } from 'react';
import { signInAction, signUpAction } from '@/app/actions/auth';
import type { AuthActionState } from '@/app/actions/auth';

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
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        errors={state.fieldErrors?.password}
      />

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
