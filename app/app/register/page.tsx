import { AuthForm } from "@/components/auth-form";

export default function RegisterPage() {
  return (
    <AuthForm
      mode="register"
      title="创建账号"
      description="一个邮箱，跨设备保存你的小说世界"
      submitLabel="注册并开始写作"
      submitPendingLabel="注册中…"
      footerText="已有账号？"
      footerLinkHref="/login"
      footerLinkLabel="直接登录"
      passwordHint="至少 8 位，仅你自己可见"
    />
  );
}
