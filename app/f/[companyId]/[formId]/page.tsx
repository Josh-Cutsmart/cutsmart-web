import type { Metadata } from "next";
import { connection } from "next/server";
import { cache } from "react";
import { PublicLeadForm } from "@/components/public-lead-form";
import { issueLeadFormTicket, loadPublicLeadForm } from "@/lib/lead-form-public-server";

// A company's lead form, public — its own link, or embedded in the company's website (?embed=1, by
// public/embed/lead-form.js: frame — which frame on that page it is; from — that page's address). Always light, as it
// would be on any website. No sign-in: everything under app/f is outside the staff app.

type PageProps = {
  params: Promise<{ companyId: string; formId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

// Read once per request — the page and its title both need it.
const loadForm = cache(loadPublicLeadForm);

function first(value: string | string[] | undefined) {
  return String(Array.isArray(value) ? value[0] : (value ?? "")).trim();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { companyId, formId } = await params;
  const loaded = await loadForm(companyId, formId);
  const title = loaded ? [loaded.form.title || loaded.form.name, loaded.companyName].filter(Boolean).join(" — ") : "Form not available";
  // (Its own title, not "· CutSmart" after it — it's the company's form, on their website.)
  return { title: { absolute: title }, robots: { index: false, follow: false } };
}

// Light, whatever the CutSmart theme on this device (the root layout's theme script reads the staff app's setting);
// embedded, no background or colour washes of its own — the website shows through.
function PageSetup({ embed }: { embed: boolean }) {
  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){try{var d=document.documentElement;d.setAttribute("data-theme","light");d.style.colorScheme="light";if(document.body){document.body.setAttribute("data-theme","light");document.body.style.colorScheme="light";}}catch(e){}})();`,
        }}
      />
      {embed ? (
        <style
          dangerouslySetInnerHTML={{
            __html: "html,body{background:transparent!important;min-height:0!important;}body::before{display:none!important;}",
          }}
        />
      ) : null}
    </>
  );
}

export default async function LeadFormPage({ params, searchParams }: PageProps) {
  await connection();
  const [{ companyId, formId }, query] = await Promise.all([params, searchParams]);
  const embed = first(query.embed) === "1";
  const loaded = await loadForm(companyId, formId);

  if (!loaded) {
    return (
      <>
        <PageSetup embed={embed} />
        <div className={embed ? "p-4" : "flex min-h-[100svh] items-center justify-center px-4"}>
          <p className="text-center text-[15px] font-medium" style={{ color: "var(--text-muted)" }}>
            This form isn&apos;t available.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageSetup embed={embed} />
      <PublicLeadForm
        companyId={companyId}
        form={loaded.form}
        companyName={loaded.companyName}
        themeColor={loaded.themeColor}
        ticket={issueLeadFormTicket(companyId, formId)}
        embed={embed}
        frameId={first(query.frame).slice(0, 64)}
        pageUrl={first(query.from).slice(0, 500)}
      />
    </>
  );
}
