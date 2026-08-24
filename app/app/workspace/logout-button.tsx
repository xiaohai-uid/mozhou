"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();

  async function onLogout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <Button
      variant="outline"
      onClick={onLogout}
      className="rounded-full border-surface-2 text-zinc-300 hover:border-zinc-600 hover:text-white"
    >
      登出
    </Button>
  );
}
