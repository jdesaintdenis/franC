import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { Wordmark } from "@/components/wordmark";
import { auth } from "@/lib/auth/server";

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) {
    redirect("/");
  }

  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Wordmark className="text-center text-4xl" />
        {children}
      </div>
    </main>
  );
}
