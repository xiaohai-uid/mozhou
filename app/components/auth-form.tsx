"use client";

// 登录/注册共享表单（深色编辑器风，全原创文案由页面侧注入）
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BrandLockup } from "@/components/brand-lockup";
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
    <div className="mz-auth-shell">
      <aside className="mz-auth-aside">
        <BrandLockup href="/" ariaLabel="返回墨舟首页" showStudio />
        <div className="mz-auth-aside-copy">
          <p className="mz-page-kicker">a quiet place to write</p>
          <h1 className="mz-auth-aside-title">把故事留在<br />自己的墨色里。</h1>
          <p className="mz-auth-aside-note">
            人物、世界观、章节和每一次修改，都在同一个写作上下文里安静地接上。
          </p>
        </div>
        <p className="hidden text-xs text-faint sm:block">自有品牌 · 模型自由 · 数据自有</p>
      </aside>

      <main className="mz-auth-main">
        <div className="mz-auth-card">
          <div className="mb-6 sm:hidden">
            <p className="mz-page-kicker">继续你的创作</p>
          </div>
          <Card className="w-full border-surface-2 bg-surface/80">
          <CardHeader>
            <CardTitle className="text-xl">{title}</CardTitle>
            <CardDescription className="text-muted">{description}</CardDescription>
          </CardHeader>
          <form onSubmit={onSubmit}>
            <CardContent className="flex flex-col gap-4">
              <label className="mz-auth-field">
                邮箱
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                />
              </label>
              <label className="mz-auth-field">
                密码
                <input
                  name="password"
                  type="password"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  required
                  minLength={8}
                />
                {passwordHint && (
                  <span className="text-xs text-faint">{passwordHint}</span>
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
                className="w-full bg-accent text-white hover:bg-accent-strong"
              >
                {pending ? submitPendingLabel : submitLabel}
              </Button>
              <p className="text-sm text-muted">
                {footerText}{" "}
                <Link href={footerLinkHref} className="text-accent hover:underline">
                  {footerLinkLabel}
                </Link>
              </p>
            </CardFooter>
          </form>
          </Card>
          <p className="mt-4 text-center text-[11px] leading-5 text-faint">
            你可以随时导出作品，服务不会替你虚构已保存的内容。
          </p>
        </div>
      </main>
    </div>
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
