import { z } from "zod";

const vapidSchema = z.object({
  publicKey: z.string().min(1),
  privateKey: z.string().min(1),
  // Push services require a contact URL for the application server.
  subject: z.string().regex(/^(mailto:|https:)\S+$/, "must start with mailto: or https:"),
});

export type VapidConfig = z.infer<typeof vapidSchema>;

/** VAPID settings from the environment, or null when push is not (fully, validly) configured. */
export function parseVapidConfig(env: Record<string, string | undefined>): VapidConfig | null {
  const parsed = vapidSchema.safeParse({
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT,
  });
  return parsed.success ? parsed.data : null;
}
