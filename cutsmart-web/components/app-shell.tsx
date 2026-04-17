"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import {
  Building2,
  ImagePlus,
  LayoutDashboard,
  LogOut,
  PlusCircle,
  Search,
  Settings,
  Trash2,
  UserCog,
  Waves,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { fetchCompanyDoc, fetchCompanyMembers } from "@/lib/firestore-data";
import { db, hasFirebaseConfig, storage } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { fetchPrimaryMembership } from "@/lib/membership";
const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";

const topNav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/recently-deleted", label: "Recently Deleted", icon: Trash2 },
  { href: "/company-updates", label: "Company Updates", icon: Waves },
  { href: "/company-settings", label: "Company Settings", icon: Settings },
];

const bottomNav = [{ href: "/user-settings", label: "User Settings", icon: UserCog }];

function initials(name: string) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "U";
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function createProjectId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `prj_${Date.now().toString(36)}_${rand}`;
}

function formatMobileLikeDesktop(input: string) {
  const digits = String(input || "").replace(/\D/g, "").slice(0, 32);
  const a = digits.slice(0, 3);
  const b = digits.slice(3, 6);
  const c = digits.slice(6);
  if (!a) return "";
  if (!b) return a;
  if (!c) return `${a} ${b}`;
  return `${a} ${b} ${c}`;
}

function normalizeTagValue(raw: string) {
  return String(raw || "").replace(/,/g, " ").replace(/\s+/g, " ").trim();
}

type LocalPhoto = { id: string; file: File; previewUrl: string; aspectRatio: number };
type StaffOption = { uid: string; name: string; email: string };
type PreviewRect = { left: number; top: number; width: number; height: number };
type PreviewAnimState = {
  id: string;
  phase: "opening" | "open" | "closing";
  from: PreviewRect;
  to: PreviewRect;
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, isDemoMode } = useAuth();
  const [showNewProject, setShowNewProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [projectAddress, setProjectAddress] = useState("");
  const [projectNotes, setProjectNotes] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [hoveredPhotoId, setHoveredPhotoId] = useState("");
  const [previewPhotoId, setPreviewPhotoId] = useState("");
  const [previewAnim, setPreviewAnim] = useState<PreviewAnimState | null>(null);
  const [previewBackdropOpacity, setPreviewBackdropOpacity] = useState(0);
  const [previewClosePopped, setPreviewClosePopped] = useState(false);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [assigneeUid, setAssigneeUid] = useState("");
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [assigneeMenuOpen, setAssigneeMenuOpen] = useState(false);
  const [projectFormError, setProjectFormError] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [companyThemeColor, setCompanyThemeColor] = useState("#2F6BFF");
  const [companyTagSuggestions, setCompanyTagSuggestions] = useState<string[]>([]);
  const [defaultProjectStatus, setDefaultProjectStatus] = useState("New");
  const [defaultQuoteExtras, setDefaultQuoteExtras] = useState<string[]>([]);
  const photoThumbRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const previewPanelRef = useRef<HTMLDivElement | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const previewCloseRafRef = useRef<number | null>(null);

  const userInitials = useMemo(() => initials(user?.displayName || "User"), [user?.displayName]);
  const userEmblemColor = String(user?.userColor || "").trim() || companyThemeColor;
  const canCreateForOthers = useMemo(() => {
    const perms = Array.isArray(user?.permissions)
      ? user.permissions.map((item) => String(item || "").trim().toLowerCase())
      : [];
    if (perms.includes("projects.create.others")) return true;
    const role = String(user?.role || "").trim().toLowerCase();
    return role === "owner" || role === "admin";
  }, [user?.permissions, user?.role]);

  useEffect(() => {
    const load = async () => {
      const storedCompanyId =
        typeof window !== "undefined" ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim() : "";
      const directCompanyId = String(user?.companyId || "").trim();
      const fallbackMembership = !directCompanyId && user?.uid ? await fetchPrimaryMembership(user.uid) : null;
      const companyId = storedCompanyId || directCompanyId || String(fallbackMembership?.companyId || "").trim();
      if (!companyId) return;
      if (typeof window !== "undefined") {
        if (!storedCompanyId) {
          window.localStorage.setItem(ACTIVE_COMPANY_STORAGE_KEY, companyId);
        }
      }
      const doc = await fetchCompanyDoc(companyId);
      const color = String((doc as Record<string, unknown> | null)?.themeColor ?? "").trim();
      if (color) {
        setCompanyThemeColor(color);
      }
    };
    void load();
  }, [user?.companyId, user?.uid]);

  useEffect(() => {
    const openNewProject = () => setShowNewProject(true);
    window.addEventListener("cutsmart:new-project", openNewProject as EventListener);
    return () => {
      window.removeEventListener("cutsmart:new-project", openNewProject as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!showNewProject) {
      setAssigneeMenuOpen(false);
      setAssigneeSearch("");
      setCompanyTagSuggestions([]);
      setDefaultProjectStatus("New");
      setDefaultQuoteExtras([]);
      return;
    }
    const load = async () => {
      const storedCompanyId =
        typeof window !== "undefined"
          ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim()
          : "";
      const directCompanyId = String(user?.companyId || "").trim();
      const fallbackMembership = !directCompanyId && user?.uid ? await fetchPrimaryMembership(user.uid) : null;
      const companyId = storedCompanyId || directCompanyId || String(fallbackMembership?.companyId || "").trim();
      if (!companyId) {
        setStaffOptions([]);
        return;
      }
      const [companyDocData, members] = await Promise.all([
        fetchCompanyDoc(companyId),
        canCreateForOthers ? fetchCompanyMembers(companyId) : Promise.resolve([]),
      ]);

      const statusRows = Array.isArray((companyDocData as Record<string, unknown> | null)?.projectStatuses)
        ? ((companyDocData as Record<string, unknown>).projectStatuses as Array<Record<string, unknown>>)
        : [];
      const firstStatusName =
        String((statusRows[0] as Record<string, unknown> | undefined)?.name || "").trim() || "New";
      setDefaultProjectStatus(firstStatusName);

      const tagUsage = (companyDocData as Record<string, unknown> | null)?.projectTagUsage;
      const rawTags =
        tagUsage && typeof tagUsage === "object" && Array.isArray((tagUsage as Record<string, unknown>).tags)
          ? ((tagUsage as Record<string, unknown>).tags as unknown[])
          : [];
      const parsedSuggestions = rawTags
        .map((item) => {
          if (!item || typeof item !== "object") return { value: "", count: 0 };
          const row = item as Record<string, unknown>;
          return {
            value: String(row.value ?? "").trim(),
            count: Number(row.count ?? 0),
          };
        })
        .filter((item) => item.value);
      parsedSuggestions.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
      setCompanyTagSuggestions(parsedSuggestions.map((item) => item.value));

      const rawQuoteExtras = Array.isArray((companyDocData as Record<string, unknown> | null)?.quoteExtras)
        ? (((companyDocData as Record<string, unknown>).quoteExtras as unknown[]) ?? [])
        : [];
      const defaultExtras = rawQuoteExtras
        .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : null))
        .filter((item) => !!item)
        .filter((item) => Boolean(item?.defaultIncluded ?? item?.default))
        .map((item) => String(item?.name ?? "").trim())
        .filter(Boolean);
      setDefaultQuoteExtras(Array.from(new Set(defaultExtras)));

      if (canCreateForOthers) {
        const options = members.map((m) => ({
          uid: String(m.uid || "").trim(),
          name: String(m.displayName || m.email || m.uid || "Unknown").trim(),
          email: String(m.email || "").trim(),
        }));
        setStaffOptions(options);
      } else {
        setStaffOptions([]);
      }
      if (!assigneeUid && user?.uid) setAssigneeUid(user.uid);
    };
    void load();
  }, [showNewProject, user?.companyId, user?.uid, assigneeUid, canCreateForOthers]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (showNewProject) {
      document.body.classList.add("new-project-open");
    } else {
      document.body.classList.remove("new-project-open");
    }
    return () => {
      document.body.classList.remove("new-project-open");
    };
  }, [showNewProject]);

  useEffect(() => {
    return () => {
      if (previewTimerRef.current) {
        window.clearTimeout(previewTimerRef.current);
      }
      if (previewCloseRafRef.current) {
        window.cancelAnimationFrame(previewCloseRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (previewCloseRafRef.current) {
      window.cancelAnimationFrame(previewCloseRafRef.current);
      previewCloseRafRef.current = null;
    }
    if (previewAnim?.phase === "open") {
      setPreviewClosePopped(false);
      previewCloseRafRef.current = window.requestAnimationFrame(() => {
        previewCloseRafRef.current = window.requestAnimationFrame(() => {
          setPreviewClosePopped(true);
          previewCloseRafRef.current = null;
        });
      });
      return;
    }
    setPreviewClosePopped(false);
  }, [previewAnim?.phase]);

  const resetProjectForm = () => {
    for (const photo of photos) {
      try {
        URL.revokeObjectURL(photo.previewUrl);
      } catch {
        // ignore
      }
    }
    setProjectName("");
    setClientName("");
    setClientPhone("");
    setClientEmail("");
    setProjectAddress("");
    setProjectNotes("");
    setTagInput("");
    setTags([]);
    setPhotos([]);
    setPreviewPhotoId("");
    setPreviewAnim(null);
    setPreviewBackdropOpacity(0);
    setPreviewClosePopped(false);
    setAssigneeSearch("");
    setAssigneeMenuOpen(false);
    setProjectFormError("");
    setCompanyTagSuggestions([]);
    setDefaultProjectStatus("New");
    setDefaultQuoteExtras([]);
  };

  const addTag = (raw: string) => {
    const next = normalizeTagValue(raw);
    if (!next) return;
    setTags((prev) => {
      const lower = new Set(prev.map((v) => v.toLowerCase()));
      if (lower.has(next.toLowerCase())) return prev;
      return [...prev, next].slice(0, 10);
    });
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  const imageAspectRatioFromFile = async (file: File): Promise<number> => {
    try {
      const blobUrl = URL.createObjectURL(file);
      const ratio = await new Promise<number>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const w = Number(img.naturalWidth || 0);
          const h = Number(img.naturalHeight || 0);
          URL.revokeObjectURL(blobUrl);
          if (w > 0 && h > 0) {
            resolve(w / h);
          } else {
            resolve(1);
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(blobUrl);
          resolve(1);
        };
        img.src = blobUrl;
      });
      return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    } catch {
      return 1;
    }
  };

  const addPhotoFiles = async (fileList: FileList | null) => {
    if (!fileList) return;
    const incoming = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (!incoming.length) return;
    const base = Date.now();
    const prepared = await Promise.all(
      incoming.map(async (file, idx) => {
        const previewUrl = URL.createObjectURL(file);
        const aspectRatio = await imageAspectRatioFromFile(file);
        return {
          id: `${base}_${idx}_${Math.random().toString(36).slice(2, 8)}`,
          file,
          previewUrl,
          aspectRatio,
        } as LocalPhoto;
      }),
    );
    setPhotos((prev) => {
      const room = Math.max(0, 5 - prev.length);
      return [...prev, ...prepared.slice(0, room)];
    });
  };

  const removePhoto = (id: string) => {
    setPhotos((prev) => {
      const found = prev.find((p) => p.id === id);
      if (found) {
        try {
          URL.revokeObjectURL(found.previewUrl);
        } catch {
          // ignore
        }
      }
      return prev.filter((p) => p.id !== id);
    });
    setPreviewPhotoId((prev) => (prev === id ? "" : prev));
    setPreviewAnim((prev) => (prev?.id === id ? null : prev));
  };

  const previewPhoto = useMemo(
    () => photos.find((p) => p.id === previewPhotoId) ?? null,
    [photos, previewPhotoId],
  );

  const computePreviewTargetRect = (photo: LocalPhoto): PreviewRect | null => {
    const panelRect = previewPanelRef.current?.getBoundingClientRect();
    if (!panelRect) return null;
    const pad = 24;
    const availableWidth = Math.max(1, panelRect.width - pad * 2);
    const availableHeight = Math.max(1, panelRect.height - pad * 2);
    const aspect = Math.max(0.01, Number(photo.aspectRatio || 1));
    let width = availableWidth;
    let height = width / aspect;
    if (height > availableHeight) {
      height = availableHeight;
      width = height * aspect;
    }
    return {
      left: panelRect.left + (panelRect.width - width) / 2,
      top: panelRect.top + (panelRect.height - height) / 2,
      width,
      height,
    };
  };

  const openPreviewAnimated = (photo: LocalPhoto) => {
    const thumb = photoThumbRefs.current[photo.id];
    const thumbRect = thumb?.getBoundingClientRect();
    const fallback: PreviewRect = {
      left: window.innerWidth / 2 - 80,
      top: window.innerHeight / 2 - 60,
      width: 160,
      height: 120,
    };
    const fromRect: PreviewRect = thumbRect
      ? {
          left: thumbRect.left,
          top: thumbRect.top,
          width: thumbRect.width,
          height: thumbRect.height,
        }
      : fallback;
    setPreviewPhotoId(photo.id);
    setPreviewClosePopped(false);
    setPreviewAnim({
      id: photo.id,
      phase: "opening",
      from: fromRect,
      to: fromRect,
    });
    setPreviewBackdropOpacity(0);

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setPreviewBackdropOpacity(1);
        const target = computePreviewTargetRect(photo);
        if (!target) return;
        setPreviewAnim((prev) => (prev && prev.id === photo.id ? { ...prev, to: target } : prev));
        if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
        previewTimerRef.current = window.setTimeout(() => {
          setPreviewAnim((prev) =>
            prev && prev.id === photo.id && prev.phase === "opening"
              ? { ...prev, phase: "open" }
              : prev,
          );
          previewTimerRef.current = null;
        }, 280);
      });
    });
  };

  const closePreviewAnimated = () => {
    if (!previewPhotoId) return;
    const id = previewPhotoId;
    setPreviewBackdropOpacity(0);
    setPreviewClosePopped(false);
    const thumb = photoThumbRefs.current[id];
    const thumbRect = thumb?.getBoundingClientRect();
    if (!previewAnim || !thumbRect) {
      setPreviewAnim(null);
      setPreviewPhotoId("");
      setPreviewBackdropOpacity(0);
      return;
    }
    const closeTo: PreviewRect = {
      left: thumbRect.left,
      top: thumbRect.top,
      width: thumbRect.width,
      height: thumbRect.height,
    };
    setPreviewAnim((prev) => (prev && prev.id === id ? { ...prev, phase: "closing", to: closeTo } : prev));
    if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = window.setTimeout(() => {
      setPreviewAnim(null);
      setPreviewPhotoId("");
      setPreviewBackdropOpacity(0);
      previewTimerRef.current = null;
    }, 280);
  };

  const selectedAssignee = useMemo(() => {
    return staffOptions.find((s) => s.uid === assigneeUid) ?? null;
  }, [staffOptions, assigneeUid]);

  const filteredStaffOptions = useMemo(() => {
    const q = String(assigneeSearch || "").trim().toLowerCase();
    if (!q) return staffOptions;
    return staffOptions.filter((s) => `${s.name} ${s.email}`.toLowerCase().includes(q));
  }, [staffOptions, assigneeSearch]);

  const onCreateProject = async () => {
    if (creatingProject) return;
    const name = String(projectName || "").trim();
    const customer = String(clientName || "").trim();
    if (!name) {
      setProjectFormError("Project Name is required.");
      return;
    }
    if (!customer) {
      setProjectFormError("Client Name is required.");
      return;
    }
    setProjectFormError("");

    if (!hasFirebaseConfig || !db) {
      setShowNewProject(false);
      router.push("/projects/prj_1001");
      return;
    }

    const storedCompanyId =
      typeof window !== "undefined"
        ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim()
        : "";
    const directCompanyId = String(user?.companyId || "").trim();
    const fallbackMembership = !directCompanyId && user?.uid ? await fetchPrimaryMembership(user.uid) : null;
    const companyId = storedCompanyId || directCompanyId || String(fallbackMembership?.companyId || "").trim();
    if (!companyId) {
      setProjectFormError("No active company selected. Join or create a company first.");
      return;
    }
    if (typeof window !== "undefined" && !storedCompanyId) {
      window.localStorage.setItem(ACTIVE_COMPANY_STORAGE_KEY, companyId);
    }

    setCreatingProject(true);
    try {
      const projectId = createProjectId();
      const nowIso = new Date().toISOString();
      const assignedName = canCreateForOthers
        ? selectedAssignee?.name || user?.displayName || "Unassigned"
        : user?.displayName || "Unassigned";
      const assignedUid = canCreateForOthers
        ? selectedAssignee?.uid || user?.uid || ""
        : user?.uid || "";
      let uploadedImageUrls: string[] = [];
      const storageClient = storage;
      if (photos.length && storageClient) {
        const uploaded = await Promise.all(
          photos.map(async (p, idx) => {
            try {
              const ext = p.file.name.includes(".") ? p.file.name.split(".").pop() : "jpg";
              const path = `companies/${companyId}/jobs/${projectId}/images/${idx + 1}_${Date.now()}.${ext}`;
              const ref = storageRef(storageClient, path);
              await uploadBytes(ref, p.file, { contentType: p.file.type || "image/jpeg" });
              return await getDownloadURL(ref);
            } catch {
              return "";
            }
          }),
        );
        uploadedImageUrls = uploaded.filter(Boolean);
      }
      const projectSettings = {
        boardTypes: [],
        projectPermissions: {},
      };
      const sales = {
        quoteExtrasIncluded: defaultQuoteExtras,
      };
      await setDoc(doc(db, "companies", companyId, "jobs", projectId), {
        id: projectId,
        companyId,
        name,
        customer,
        clientName: customer,
        client: customer,
        clientNumber: clientPhone.trim(),
        clientPhone: clientPhone.trim(),
        clientEmail: clientEmail.trim(),
        clientAddress: projectAddress.trim(),
        notes: projectNotes,
        createdByUid: user?.uid ?? "",
        createdByName: user?.displayName ?? "CutSmart User",
        assignedTo: assignedName,
        assignedToUid: assignedUid,
        createdAtIso: nowIso,
        updatedAtIso: nowIso,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: defaultProjectStatus || "New",
        tags,
        isDeleted: false,
        projectImages: uploadedImageUrls,
        cutlist: { rows: [] },
        cutlistJson: { rows: [] },
        projectSettings,
        projectSettingsJson: JSON.stringify(projectSettings),
        sales,
        salesJson: JSON.stringify(sales),
      });
      setShowNewProject(false);
      resetProjectForm();
      router.push(`/projects/${projectId}`);
    } catch (error) {
      const message =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code || "create-failed")
          : String((error as { message?: unknown } | null)?.message || "Could not create project.");
      setProjectFormError(`Could not create project (${message}).`);
    } finally {
      setCreatingProject(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-app)]">
      <aside
        className="z-[70] flex w-[230px] flex-col overflow-hidden border-r border-[var(--panel-border)] bg-white"
        style={{ position: "fixed", left: 0, top: 0, height: "100vh" }}
      >
        <div className="border-b border-[var(--panel-border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="rounded-[10px] border border-[var(--panel-border)] bg-[var(--brand)] p-2 text-white">
              <Building2 size={16} />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-muted)]">CutSmart</p>
              <p className="text-[13px] font-bold text-[var(--text-main)]">Web Workspace</p>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 h-full flex-1 flex-col px-3 py-3">
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            <button
              type="button"
              onClick={() => setShowNewProject(true)}
              className="flex w-full items-center gap-2 rounded-[10px] border border-transparent px-3 py-2 text-left text-[12px] font-bold text-[#475467] transition hover:border-[#E4E7EC] hover:bg-[#F7F8FC]"
            >
              <PlusCircle size={16} />
              New Project
            </button>
            {topNav.map((item) => {
              const active = pathname?.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[12px] font-bold transition",
                    active
                      ? "border-[var(--panel-border)] bg-[var(--panel-muted)] text-[var(--brand)]"
                      : "border-transparent text-[#475467] hover:border-[#E4E7EC] hover:bg-[#F7F8FC]",
                  )}
                >
                  <Icon size={16} />
                  {item.label}
                </Link>
              );
            })}
          </div>

          <div className="shrink-0 space-y-1 border-t border-[var(--panel-border)] pt-3">
            {bottomNav.map((item) => {
              const active = pathname?.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[12px] font-bold transition",
                    active
                      ? "border-[var(--panel-border)] bg-[var(--panel-muted)] text-[var(--brand)]"
                      : "border-transparent text-[#475467] hover:border-[#E4E7EC] hover:bg-[#F7F8FC]",
                  )}
                >
                  <Icon size={16} />
                  {item.label}
                </Link>
              );
            })}
            <Button variant="ghost" size="sm" className="h-8 w-full justify-start" onClick={() => void logout()}>
              <LogOut size={14} className="mr-2" />
              Log Out
            </Button>
            <div className="mt-2 flex items-center gap-2 rounded-[10px] border border-[#E4E7EC] bg-[#F8FAFC] px-2 py-2">
              <div
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-extrabold text-white"
                style={{ backgroundColor: userEmblemColor }}
              >
                {userInitials}
              </div>
              <span className="truncate text-[12px] font-semibold text-[#0F172A]">{user?.displayName || "CutSmart User"}</span>
            </div>
            {isDemoMode && (
              <span className="inline-flex rounded-[8px] border border-[#F1D46A] bg-[#FFF7CC] px-2 py-1 text-[11px] font-bold text-[#7A5A00]">
                Demo data mode
              </span>
            )}
          </div>
        </div>
      </aside>

      <div
        className="min-w-0 overflow-x-hidden"
        style={{ width: "100%", paddingLeft: 230 }}
      >
        <main className="min-w-0 overflow-x-clip px-4 py-4 md:px-5">{children}</main>
      </div>

      {showNewProject && (
        <div
          className="fixed inset-0 z-[9000] flex items-center justify-center px-4"
          style={{
            backgroundColor: "rgba(8,12,20,0.52)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          <div
            className="relative flex flex-col overflow-hidden rounded-[14px] border border-[#D7DEE8] bg-white p-4 shadow-xl"
            style={{ width: 1000, height: 600, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 32px)" }}
          >
            <p className="text-[15px] font-extrabold uppercase tracking-[1px] text-[#12345B]">New Project</p>
            <div className="relative mt-3 flex-1 space-y-3 overflow-y-auto pr-1">
              <div className="grid items-center gap-3" style={{ gridTemplateColumns: "220px minmax(0, 1fr)" }}>
                <p className="text-[11px] font-bold text-[#475467]">Project Name</p>
                <input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className="h-9 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                  placeholder="Project name"
                />
              </div>
              <div className="grid items-center gap-3" style={{ gridTemplateColumns: "220px minmax(0, 1fr)" }}>
                <p className="text-[11px] font-bold text-[#475467]">Client Name</p>
                <input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className="h-9 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                  placeholder="Client name"
                />
              </div>
              <div className="grid items-center gap-3" style={{ gridTemplateColumns: "220px minmax(0, 1fr)" }}>
                <p className="text-[11px] font-bold text-[#475467]">Client Phone</p>
                <input
                  value={clientPhone}
                  onChange={(e) => setClientPhone(formatMobileLikeDesktop(e.target.value))}
                  className="h-9 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                  placeholder="021 234 5678"
                />
              </div>
              <div className="grid items-center gap-3" style={{ gridTemplateColumns: "220px minmax(0, 1fr)" }}>
                <p className="text-[11px] font-bold text-[#475467]">Client Email</p>
                <input
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  className="h-9 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                  placeholder="client@email.com"
                />
              </div>
              <div className="grid items-center gap-3" style={{ gridTemplateColumns: "220px minmax(0, 1fr)" }}>
                <p className="text-[11px] font-bold text-[#475467]">Project Address</p>
                <input
                  value={projectAddress}
                  onChange={(e) => setProjectAddress(e.target.value)}
                  className="h-9 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                  placeholder="Street, suburb, city"
                />
              </div>
              {projectAddress.trim().length > 5 && (
                <div className="grid items-start gap-3" style={{ gridTemplateColumns: "220px minmax(0, 1fr)" }}>
                  <div />
                  <div className="overflow-hidden rounded-[10px] border border-[#D8DEE8]">
                    <iframe
                      title="Address preview"
                      className="h-[170px] w-full border-0"
                      src={`https://maps.google.com/maps?q=${encodeURIComponent(projectAddress.trim())}&t=&z=13&ie=UTF8&iwloc=&output=embed`}
                    />
                  </div>
                </div>
              )}
              <div className="grid items-start gap-3" style={{ gridTemplateColumns: "220px minmax(0, 1fr)" }}>
                <p className="pt-2 text-[11px] font-bold text-[#475467]">Tags</p>
                <div>
                  <div className="flex items-center gap-2">
                    <input
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === ",") {
                          e.preventDefault();
                          addTag(tagInput);
                        }
                      }}
                      className="h-9 flex-1 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                      placeholder="Type tag and press Enter"
                      list="new-project-tag-suggestions"
                    />
                    <button
                      type="button"
                      onClick={() => addTag(tagInput)}
                      className="h-9 rounded-[8px] border border-[#CFE1FF] bg-[#EDF4FF] px-3 text-[12px] font-bold text-[#2F6BFF]"
                    >
                      Add
                    </button>
                  </div>
                  {!!tags.length && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {tags.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => removeTag(tag)}
                          className="inline-flex items-center gap-1 rounded-[999px] border border-[#D6DEE9] bg-[#EEF2F7] px-2 py-[2px] text-[11px] font-bold text-[#475569]"
                        >
                          {tag}
                          <X size={12} />
                        </button>
                      ))}
                    </div>
                  )}
                  {!!companyTagSuggestions.length && (
                    <datalist id="new-project-tag-suggestions">
                      {companyTagSuggestions.map((tag) => (
                        <option key={tag} value={tag} />
                      ))}
                    </datalist>
                  )}
                </div>
              </div>
              <div className="grid items-start gap-3" style={{ gridTemplateColumns: "220px minmax(0, 1fr)" }}>
                <p className="pt-2 text-[11px] font-bold text-[#475467]">Notes</p>
                <textarea
                  value={projectNotes}
                  onChange={(e) => setProjectNotes(e.target.value)}
                  className="w-full resize-none rounded-[8px] border border-[#D8DEE8] bg-white px-2 py-2 text-[12px]"
                  style={{ height: 88, minHeight: 88 }}
                  placeholder="Project notes..."
                />
              </div>
              <div className="grid items-start gap-3" style={{ gridTemplateColumns: "220px minmax(0, 1fr)" }}>
                <p className="pt-2 text-[11px] font-bold text-[#475467]">Photos (max 5)</p>
                <div
                  className="grid w-full gap-2"
                  style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}
                >
                  {Array.from({ length: Math.min(photos.length + 1, 5) }).map((_, idx) => {
                    const photo = photos[idx] ?? null;
                    return (
                      <div
                        key={`photo_slot_${idx}`}
                        className="relative flex items-center justify-center"
                        style={{ height: 88, minHeight: 88 }}
                        onMouseLeave={() => setHoveredPhotoId("")}
                      >
                        {photo ? (
                          <>
                            <div
                              className="relative flex h-full items-center justify-center overflow-hidden rounded-[8px] border border-[#D8DEE8] bg-transparent"
                              onMouseEnter={() => setHoveredPhotoId(photo.id)}
                              style={{
                                width:
                                  photo.aspectRatio < 1
                                    ? Math.max(42, Math.round(88 * photo.aspectRatio))
                                    : "100%",
                                minWidth: photo.aspectRatio < 1 ? 42 : undefined,
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => openPreviewAnimated(photo)}
                                ref={(el) => {
                                  photoThumbRefs.current[photo.id] = el;
                                }}
                                className="flex h-full w-full cursor-zoom-in items-center justify-center leading-none"
                                title="Click to enlarge"
                              >
                                <img
                                  src={photo.previewUrl}
                                  alt={`Photo ${idx + 1}`}
                                  className="block h-full w-full object-cover"
                                  style={{ objectFit: "cover", objectPosition: "center" }}
                                />
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => removePhoto(photo.id)}
                              onMouseDown={(e) => e.stopPropagation()}
                              className="absolute left-1/2 inline-flex -translate-x-1/2 items-center justify-center rounded-full text-white transition-opacity duration-150"
                              style={{
                                bottom: 6,
                                width: 24,
                                height: 24,
                                border: "1px solid #7F1D1D",
                                background: "#EF4444",
                                boxShadow: "0 2px 6px rgba(0,0,0,0.28)",
                                opacity: hoveredPhotoId === photo.id ? 1 : 0,
                                pointerEvents: hoveredPhotoId === photo.id ? "auto" : "none",
                              }}
                              aria-label="Remove photo"
                            >
                              <img
                                src="/trash.png"
                                alt="Delete"
                                className="object-contain"
                                style={{ width: 12, height: 12, filter: "brightness(0) invert(1)" }}
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                }}
                              />
                            </button>
                          </>
                        ) : (
                          <label className="relative flex h-full w-full cursor-pointer items-center justify-center overflow-hidden rounded-[8px] border border-[#D8DEE8] bg-[#F8FAFC] text-[11px] font-bold text-[#64748B]">
                            <span
                              aria-hidden="true"
                              className="pointer-events-none absolute"
                              style={{
                                width: 24,
                                height: 24,
                                backgroundColor: companyThemeColor || "#7C8EA5",
                                WebkitMaskImage: "url('/add-image.png')",
                                WebkitMaskRepeat: "no-repeat",
                                WebkitMaskPosition: "center",
                                WebkitMaskSize: "contain",
                                maskImage: "url('/add-image.png')",
                                maskRepeat: "no-repeat",
                                maskPosition: "center",
                                maskSize: "contain",
                              }}
                            />
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              style={{ display: "none" }}
                              onChange={(e) => {
                                void addPhotoFiles(e.target.files);
                                e.currentTarget.value = "";
                              }}
                            />
                          </label>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              {canCreateForOthers && (
                <div className="grid items-start gap-3" style={{ gridTemplateColumns: "220px minmax(0, 1fr)" }}>
                  <p className="pt-2 text-[11px] font-bold text-[#475467]">Assign Project To</p>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setAssigneeMenuOpen((v) => !v)}
                      className="flex h-9 w-full items-center justify-between rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-left text-[12px]"
                    >
                      <span className="truncate">{selectedAssignee?.name || "Select staff member"}</span>
                      <span className="text-[#64748B]">&#9662;</span>
                    </button>
                    {assigneeMenuOpen && (
                      <div className="absolute z-20 mt-1 w-full rounded-[8px] border border-[#D8DEE8] bg-white shadow-lg">
                        <div className="relative border-b border-[#E2E8F0] px-2 py-2">
                          <Search size={13} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
                          <input
                            value={assigneeSearch}
                            onChange={(e) => setAssigneeSearch(e.target.value)}
                            className="h-8 w-full rounded-[7px] border border-[#D8DEE8] bg-white pl-7 pr-2 text-[12px]"
                            placeholder="Search staff..."
                          />
                        </div>
                        <div className="max-h-[180px] overflow-y-auto py-1">
                          {filteredStaffOptions.map((s) => (
                            <button
                              key={s.uid}
                              type="button"
                              onClick={() => {
                                setAssigneeUid(s.uid);
                                setAssigneeMenuOpen(false);
                              }}
                              className="block w-full px-2 py-2 text-left text-[12px] hover:bg-[#F1F5F9]"
                            >
                              <p className="font-semibold text-[#0F172A]">{s.name}</p>
                              <p className="text-[11px] text-[#64748B]">{s.email}</p>
                            </button>
                          ))}
                          {!filteredStaffOptions.length && (
                            <div className="px-2 py-2 text-[12px] text-[#64748B]">No staff found.</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {!!projectFormError && (
                <p className="text-[12px] font-semibold text-[#B42318]">{projectFormError}</p>
              )}
            </div>
            {previewPhoto && (
              <div
                className="absolute inset-0 z-30 flex items-center justify-center p-4"
                onClick={closePreviewAnimated}
                style={{
                  backgroundColor: "rgba(255,255,255,0.88)",
                  opacity: previewBackdropOpacity,
                  transition: "opacity 260ms ease",
                }}
              >
                <div
                  className="relative overflow-hidden rounded-[12px] bg-[rgba(10,14,24,0.78)]"
                  ref={previewPanelRef}
                  style={{
                    width: "calc(100% - 32px)",
                    height: "calc(100% - 102px)",
                  }}
                />
              </div>
            )}
            {previewPhoto && previewAnim && (
              <div
                className="fixed inset-0"
                style={{ zIndex: 2147483646 }}
                onClick={closePreviewAnimated}
              >
                <img
                  src={previewPhoto.previewUrl}
                  alt="Animated preview"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: "fixed",
                    left: previewAnim.to.left,
                    top: previewAnim.to.top,
                    width: previewAnim.to.width,
                    height: previewAnim.to.height,
                    objectFit: "contain",
                    transition: "left 260ms ease, top 260ms ease, width 260ms ease, height 260ms ease",
                    opacity: 1,
                    filter: "none",
                    willChange: "left, top, width, height",
                    pointerEvents: "auto",
                    borderRadius: 12,
                  }}
                />
              </div>
            )}
            {previewPhoto && previewAnim?.phase === "open" && (
              <button
                type="button"
                onClick={closePreviewAnimated}
                style={{
                  position: "fixed",
                  left: previewAnim.to.left + previewAnim.to.width / 2 - 22,
                  top: previewAnim.to.top + previewAnim.to.height + 10,
                  width: 44,
                  height: 44,
                  zIndex: 2147483647,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 9999,
                  border: "2px solid #FCA5A5",
                  background: "#DC2626",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.22)",
                  cursor: "pointer",
                  opacity: previewClosePopped ? 1 : 0,
                  transform: previewClosePopped ? "translateY(0) scale(1)" : "translateY(-14px) scale(0.88)",
                  transition: "opacity 180ms ease, transform 220ms cubic-bezier(0.2, 0.7, 0.2, 1)",
                  pointerEvents: previewClosePopped ? "auto" : "none",
                }}
                aria-label="Close image preview"
              >
                <img
                  src="/cross-small.png"
                  alt="Close"
                  style={{ width: 22, height: 22, objectFit: "contain", filter: "brightness(0) invert(1)" }}
                />
              </button>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowNewProject(false);
                  resetProjectForm();
                }}
                className="h-9 rounded-[9px] border border-[#D8DEE8] bg-white px-3 text-[12px] font-bold text-[#334155]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={creatingProject}
                onClick={() => void onCreateProject()}
                className="h-9 rounded-[9px] border border-[#C8DAFF] bg-[#EAF1FF] px-3 text-[12px] font-bold text-[#24589A] disabled:opacity-55"
              >
                {creatingProject ? "Creating..." : "Create Project"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
