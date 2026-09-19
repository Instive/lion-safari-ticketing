"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { loginAction, type LoginState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="touch-target w-full rounded-lg bg-brand px-4 text-base font-semibold text-white transition-colors hover:bg-brand-strong disabled:opacity-60"
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState<LoginState, FormData>(loginAction, {});

  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={formAction} className="space-y-4 rounded-xl border border-line bg-surface p-6">
      <div>
        <label htmlFor="username" className="mb-1 block text-sm font-medium">
          Username
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          required
          className="touch-target w-full rounded-lg border border-line px-3 text-base outline-none focus:border-brand"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <div className="relative">
        <input
          id="password"
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          required
          className="touch-target w-full rounded-lg border border-line pl-3 pr-20 text-base outline-none focus:border-brand"
        />
        <button type="button" aria-controls="password" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-1 right-1 rounded-md px-3 text-sm font-semibold text-brand hover:bg-brand/5">{showPassword ? "Hide" : "Show"}</button>
        </div>
      </div>

      {state.error ? (
        <p role="alert" className="rounded-lg bg-danger/5 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
