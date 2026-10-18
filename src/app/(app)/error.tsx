"use client";

import { ErrorFallback } from "@/components/error-fallback";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorFallback error={error} retry={retry} />;
}
