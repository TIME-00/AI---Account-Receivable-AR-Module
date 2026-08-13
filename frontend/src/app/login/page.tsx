"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/auth-provider";
import { Zap, Mail, Lock, Eye, EyeOff, Loader2 } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { signIn } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const { error } = await signIn(email, password);
      if (error) {
        setError(error.message);
      } else {
        router.push("/");
      }
    } catch {
      setError("Login failed. Please try again later.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-app-bg">
      {/* Ambient background. Radial gradients rather than blurred orbs: the
          same depth at a fraction of the raster cost, and both layers are
          static so nothing animates behind the sign-in form. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 50% at 22% 24%, rgb(var(--brand) / 0.18) 0%, transparent 62%), radial-gradient(55% 45% at 78% 78%, rgb(var(--c-violet-500) / 0.14) 0%, transparent 62%)",
          }}
        />
        {/* Engineering grid — drawn from the hairline token so it is a light
            rule on the dark ground and a dark rule on the light one. */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(rgb(var(--hairline) / var(--hairline-alpha)) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--hairline) / var(--hairline-alpha)) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
            maskImage:
              "radial-gradient(75% 60% at 50% 45%, #000 0%, transparent 100%)",
            WebkitMaskImage:
              "radial-gradient(75% 60% at 50% 45%, #000 0%, transparent 100%)",
          }}
        />
      </div>

      {/* Login Card */}
      <div className="ds-page-enter relative z-10 w-full max-w-md px-6">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <div className="ds-glow mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700">
            <Zap className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            TSH Synergy
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Accounts Receivable Module
          </p>
        </div>

        {/* Form Card */}
        <div className="ds-surface-elevated rounded-2xl p-8">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-slate-900">Welcome Back</h2>
            <p className="mt-1 text-sm text-slate-500">
              Sign in to the AR Module
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label
                htmlFor="login-email"
                className="mb-1.5 block text-xs font-medium text-slate-600"
              >
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  className="input-premium h-11 w-full pl-10 pr-4"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="login-password"
                className="mb-1.5 block text-xs font-medium text-slate-600"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="input-premium h-11 w-full pl-10 pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="ds-press absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div role="alert" className="ds-overlay-enter rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="ds-press flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-brand-600 to-brand-700 text-sm font-semibold text-white shadow-card hover:from-brand-500 hover:to-brand-600 hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          {/* Footer */}
          <div className="mt-6 text-center">
            <p className="text-xs text-slate-400">
              GenAI Powered · TSH Synergy ERP
            </p>
          </div>
        </div>

        {/* Copyright */}
        <p className="mt-6 text-center text-[11px] text-slate-400">
          © 2026 TSH Synergy Sdn Bhd. All rights reserved.
        </p>
      </div>
    </div>
  );
}
