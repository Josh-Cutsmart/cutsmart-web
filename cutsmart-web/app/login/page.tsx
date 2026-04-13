"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { hasFirebaseConfig } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import type { UserRole } from "@/lib/types";

const roles: UserRole[] = ["owner", "admin", "sales", "production", "viewer"];

export default function LoginPage() {
  const router = useRouter();
  const { signIn, signInDemo } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (hasFirebaseConfig) {
        await signIn(email, password);
      } else {
        signInDemo("owner");
      }
      router.push("/dashboard");
    } catch {
      setError("Could not sign in. Check Firebase Auth users and credentials.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-app)] px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign in to CutSmart</CardTitle>
          <CardDescription>
            Use your CutSmart account. Demo roles are available if Firebase is not configured.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={onSubmit}>
            <Input
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required={hasFirebaseConfig}
            />
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required={hasFirebaseConfig}
            />
            {error && <p className="text-sm text-[#B42318]">{error}</p>}
            <Button className="w-full" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Signing in..." : hasFirebaseConfig ? "Sign In" : "Continue in Demo"}
            </Button>
          </form>

          {!hasFirebaseConfig && (
            <div className="mt-4">
              <p className="mb-2 text-xs uppercase tracking-wider text-[var(--text-muted)]">Demo roles</p>
              <div className="flex flex-wrap gap-2">
                {roles.map((role) => (
                  <Button
                    key={role}
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      signInDemo(role);
                      router.push("/dashboard");
                    }}
                  >
                    {role}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
