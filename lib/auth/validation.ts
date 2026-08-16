import { z } from "zod";

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(6),
  next: z.string().optional(),
});

export const signupSchema = z.object({
  email: z.email(),
  password: z.string().min(6),
  confirmPassword: z.string().min(6),
  next: z.string().optional(),
}).refine((values) => values.password === values.confirmPassword, {
  message: "Passwords must match.",
  path: ["confirmPassword"],
});

export function safeReturnPath(value: unknown, fallback = "/dashboard") {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

