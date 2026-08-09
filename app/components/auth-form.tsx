"use client";

// 登录/注册共享表单（深色编辑器风，全原创文案由页面侧注入）
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface AuthFormProps {
  mode: "login" | "register";
  title: string;
  description: string;
  submitLabel: string;
  submitPendingLabel: string;
  footerText: string;
  footerLinkHref: string;
  footerLinkLabel: string;
  passwordHint?: string;
}

export function AuthForm({
  mode,
  title,
  description,
  submitLabel,
  submitPendingLabel,
  footerText,
  footerLinkHref,
  footerLinkLabel,
  passwordHint,
}: AuthFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const res = await fetch(`/api/v1/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
      }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok) {
      router.push(mode === "login" ? loginNextTarget() : "/workspace");
      router.refresh();
    } else {
      setError(data?.error ?? `${mode === "login" ? "登录" : "注册"}失败，请稍后重试`);
      setPending(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <Card className="w-full max-w-sm border-zinc-800 bg-zinc-900/60">
        <CardHeader>
          <CardTitle className="text-xl">{title}</CardTitle>
          <CardDescription className="text-zinc-400">{description}</CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm text-zinc-300">
              邮箱
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none transition focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm text-zinc-300">
              密码
              <input
                name="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
                minLength={8}
                className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none transition focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
              />
              {passwordHint && (
                <span className="text-xs text-zinc-500">{passwordHint}</span>
              )}
            </label>
            {error && (
              <p role="alert" className="text-sm text-red-400">
                {error}
              </p>
            )}
          </CardContent>
          <CardFooter className="flex-col gap-3">
            <Button
              type="submit"
              disabled={pending}
              className="w-full bg-violet-600 hover:bg-violet-500"
            >
              {pending ? submitPendingLabel : submitLabel}
            </Button>
            <p className="text-sm text-zinc-400">
              {footerText}{" "}
              <Link href={footerLinkHref} className="text-violet-400 hover:underline">
                {footerLinkLabel}
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}

/** 登录成功后跳回 proxy 记下的 next 目标；仅允许站内相对路径（防 open redirect） */
function loginNextTarget(): string {
  if (typeof window === "undefined") return "/workspace";
  const next = new URLSearchParams(window.location.search).get("next");
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    return next;
  }
  return "/workspace";
}
