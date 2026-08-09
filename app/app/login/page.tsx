import { AuthForm } from "@/components/auth-form";

export default function LoginPage() {
  return (
    <AuthForm
      mode="login"
      title="欢迎回来"
      description="登录墨舟，继续你的创作"
      submitLabel="登录"
      submitPendingLabel="登录中…"
      footerText="还没有账号？"
      footerLinkHref="/register"
      footerLinkLabel="立即注册"
    />
  );
}
