import bcrypt from "bcryptjs";
import { z } from "zod";

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(128, "Use at most 128 characters")
  .regex(/[A-Za-z]/, "Include at least one letter")
  .regex(/[0-9]/, "Include at least one number");

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

// Used to keep login timing constant when the email doesn't exist.
export const DUMMY_HASH = "$2a$12$CwTycUXWue0Thq9StjUM0uJ8.4Vb0QnRWvWJ1nYQ8a3TQ2PZ6sXe2";
