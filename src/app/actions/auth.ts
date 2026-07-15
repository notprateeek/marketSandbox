'use server';

import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';

import { signIn, signOut } from '@/auth';
import { credentialsSchema, registrationSchema } from '@/lib/validation/auth';
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
