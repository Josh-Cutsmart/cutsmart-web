"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Joining or creating a company is now the last step of the login screen ("/"), which picks it up for
// a signed-in account with no company.
export default function CompanyOnboardingRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/");
  }, [router]);

  return null;
}
