import { z } from "zod";

export const authSchema = {
  sessionId: z.object({ params: z.object({ id: z.string().uuid() }) }),
  register: z.object({
    body: z.object({
      name: z
        .string()
        .min(3, "Username must be at least 3 characters")
        .max(15, "Username cannot exceed 15 characters"),
      email: z.string().email("Please enter a valid email address"),
      password: z.string().min(6, "Password must be at least 6 characters"),
    }),
  }),

  login: z.object({
    body: z.object({
      email: z
        .string()
        .min(1, "Email address is required")
        .email("Please enter a valid email address"),
      password: z
        .string()
        .min(1, "Password is required")
        .min(6, "Password must be at least 6 characters long"),
    }),
  }),

  forgotPassword: z.object({
    body: z.object({
      email: z.string().email("Please enter a valid email address"),
    }),
  }),

  resetPassword: z.object({
    body: z.object({
      token: z.string().min(1, "Reset token is required"),
      password: z.string().min(6, "Password must be at least 6 characters"),
    }),
  }),

  verifyEmail: z.object({
    body: z.object({
      token: z.string().min(1, "Verification token is required"),
    }),
  }),

  googleLogin: z.object({
    body: z.object({
      credential: z.string().min(1, "Google credential is required"),
    }),
  }),

  twoFactorChallenge: z.object({
    body: z.object({
      challengeToken: z.string().regex(/^[A-Za-z\d_-]{40,60}$/),
      code: z.string().regex(/^(\d{6}|[A-F\d]{16})$/i),
    }),
  }),
};
