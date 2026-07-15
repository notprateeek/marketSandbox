import { z } from 'zod';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const emailSchema = z
  .string()
  .trim()
  .max(254, 'Email is too long.')
  .email('Enter a valid email address.')
  .transform(normalizeEmail);

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(128, 'Password must be at most 128 characters.');

export const registrationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Enter your name.')
    .max(100, 'Name must be at most 100 characters.'),
  email: emailSchema,
  password: passwordSchema,
});

export const credentialsSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export type RegistrationInput = z.infer<typeof registrationSchema>;
