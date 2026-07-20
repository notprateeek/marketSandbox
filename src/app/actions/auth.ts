'use server';

import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';

import { signIn, signOut } from '@/auth';
import {
  credentialsSchema,
  passwordResetRequestSchema,
  passwordResetSchema,
  registrationSchema,
} from '@/lib/validation/auth';
import {
  createPasswordResetToken,
  resetPasswordWithToken,
} from '@/server/services/password-reset';
import { registerUser } from '@/server/services/register-user';

export type AuthActionState = {
  fieldErrors?: {
    name?: string[];
    email?: string[];
    password?: string[];
  };
  formError?: string;
};

function safeRedirectTarget(value: FormDataEntryValue | null, fallback: string) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  ) {
    return fallback;
  }

  const url = new URL(value, 'http://local');
  return url.origin === 'http://local' ? `${url.pathname}${url.search}${url.hash}` : fallback;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

async function authenticate(email: string, password: string): Promise<AuthActionState | undefined> {
  try {
    await signIn('credentials', { email, password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError && error.type === 'CredentialsSignin') {
      return { formError: 'Invalid email or password.' };
    }
    throw error;
  }
}

export async function signUpAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = registrationSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await registerUser(parsed.data);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { formError: 'An account with this email already exists.' };
    }
    throw error;
  }

  const authError = await authenticate(parsed.data.email, parsed.data.password);
  if (authError) return authError;

  redirect(safeRedirectTarget(formData.get('redirectTo'), '/'));
}

export async function signInAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const authError = await authenticate(parsed.data.email, parsed.data.password);
  if (authError) return authError;

  redirect(safeRedirectTarget(formData.get('redirectTo'), '/'));
}

export async function signOutAction(formData: FormData): Promise<void> {
  await signOut({ redirect: false });
  redirect(safeRedirectTarget(formData.get('redirectTo'), '/sign-in'));
}

export type ResetRequestState = {
  submitted?: boolean;
  resetPath?: string;
  fieldErrors?: { email?: string[] };
};

export async function requestPasswordResetAction(
  _previousState: ResetRequestState,
  formData: FormData,
): Promise<ResetRequestState> {
  const parsed = passwordResetRequestSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const token = await createPasswordResetToken(parsed.data.email);
  // ponytail: demo only — the reset link is returned to the browser instead of
  // emailed. Ceiling: anyone who knows an email can reset that account. Upgrade:
  // deliver `token` out-of-band (email/SMS) and stop returning `resetPath`.
  return {
    submitted: true,
    resetPath: token ? `/reset-password?token=${encodeURIComponent(token)}` : undefined,
  };
}

export type ResetPasswordState = {
  fieldErrors?: { password?: string[] };
  formError?: string;
};

export async function resetPasswordAction(
  _previousState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const parsed = passwordResetSchema.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    if (fieldErrors.token) {
      return { formError: 'This reset link is invalid. Request a new one.' };
    }
    return { fieldErrors: { password: fieldErrors.password } };
  }

  let ok = false;
  try {
    ok = await resetPasswordWithToken(parsed.data.token, parsed.data.password);
  } catch {
    ok = false;
  }
  if (!ok) {
    return { formError: 'This reset link is invalid or has expired. Request a new one.' };
  }

  redirect('/sign-in?reset=1');
}
