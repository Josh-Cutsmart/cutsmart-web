"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import {
  Building2,
  ImagePlus,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  PlusCircle,
  Search,
  Settings,
  Tag,
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
const COMPANY_BRANDING_CACHE_KEY_PREFIX = "cutsmart_company_branding_";

type CompanyBrandingCache = {
  themeColor: string;
  logoPath: string;
  name: string;
};

const brandingMemoryCacheByCompany: Record<string, CompanyBrandingCache> = {};

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

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function notesToDisplayHtml(value: unknown): string {
  const raw = String(value ?? "");
  if (!raw.trim()) return "";
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(raw);
  if (looksLikeHtml) return raw;
  return escapeHtml(raw).replace(/\n/g, "<br />");
}

function notesHtmlIsEmpty(value: string): boolean {
  const plain = String(value || "")
    .replace(/<br\s*\/?>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]*>/g, "")
    .trim();
  return !plain;
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
  const [newProjectNotesParagraphMode, setNewProjectNotesParagraphMode] = useState(false);
  const [newProjectNotesBulletMode, setNewProjectNotesBulletMode] = useState(false);
  const [newProjectNotesBoldActive, setNewProjectNotesBoldActive] = useState(false);
  const [newProjectNotesItalicActive, setNewProjectNotesItalicActive] = useState(false);
  const [newProjectNotesStrikeActive, setNewProjectNotesStrikeActive] = useState(false);
  const [isNewProjectNotesFocused, setIsNewProjectNotesFocused] = useState(false);
  const [newProjectNotesHeight, setNewProjectNotesHeight] = useState(88);
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [isTagInputOpen, setIsTagInputOpen] = useState(false);
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [companyThemeColor, setCompanyThemeColor] = useState("#2F6BFF");
  const [companyLogoPath, setCompanyLogoPath] = useState("");
  const [companyDisplayName, setCompanyDisplayName] = useState("");
  const [companyTagSuggestions, setCompanyTagSuggestions] = useState<string[]>([]);
  const [defaultProjectStatus, setDefaultProjectStatus] = useState("New");
  const [defaultQuoteExtras, setDefaultQuoteExtras] = useState<string[]>([]);
  const photoThumbRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const previewPanelRef = useRef<HTMLDivElement | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const previewCloseRafRef = useRef<number | null>(null);
  const newProjectTagInputRef = useRef<HTMLInputElement | null>(null);
  const newProjectNotesContainerRef = useRef<HTMLDivElement | null>(null);
  const newProjectNotesEditorRef = useRef<HTMLDivElement | null>(null);
  const newProjectNotesLastEnterAtRef = useRef(0);

  const userInitials = useMemo(() => initials(user?.displayName || "User"), [user?.displayName]);
  const userEmblemColor = String(user?.userColor || "").trim() || companyThemeColor;
  const isProjectDetailsRoute = useMemo(() => /^\/projects\/[^/]+/.test(String(pathname || "")), [pathname]);
  const canCreateForOthers = useMemo(() => {
    const perms = Array.isArray(user?.permissions)
      ? user.permissions.map((item) => String(item || "").trim().toLowerCase())
      : [];
    if (perms.includes("projects.create.others")) return true;
    const role = String(user?.role || "").trim().toLowerCase();
    return role === "owner" || role === "admin";
  }, [user?.permissions, user?.role]);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const storedCompanyId = String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim();
    const directCompanyId = String(user?.companyId || "").trim();
    const companyId = storedCompanyId || directCompanyId;
    if (!companyId) return;

    const fromMemory = brandingMemoryCacheByCompany[companyId];
    if (fromMemory) {
      setCompanyThemeColor(fromMemory.themeColor || "#2F6BFF");
      setCompanyLogoPath(fromMemory.logoPath || "");
      setCompanyDisplayName(fromMemory.name || "");
      return;
    }

    try {
      const raw = window.localStorage.getItem(`${COMPANY_BRANDING_CACHE_KEY_PREFIX}${companyId}`);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const themeColor = String(parsed.themeColor || "").trim() || "#2F6BFF";
      const logoPath = String(parsed.logoPath || "").trim();
      const name = String(parsed.name || "").trim();
      setCompanyThemeColor(themeColor);
      setCompanyLogoPath(logoPath);
      setCompanyDisplayName(name);
      brandingMemoryCacheByCompany[companyId] = { themeColor, logoPath, name };
    } catch {
      // ignore cache parse issues
    }
  }, [user?.companyId]);

  useEffect(() => {
    const load = async () => {
      const readBrandingCache = (companyId: string) => {
        if (typeof window === "undefined") return null;
        try {
          const raw = window.localStorage.getItem(`${COMPANY_BRANDING_CACHE_KEY_PREFIX}${companyId}`);
          if (!raw) return null;
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          return {
            themeColor: String(parsed.themeColor || "").trim(),
            logoPath: String(parsed.logoPath || "").trim(),
            name: String(parsed.name || "").trim(),
          };
        } catch {
          return null;
        }
      };
      const writeBrandingCache = (companyId: string, payload: { themeColor: string; logoPath: string; name: string }) => {
        if (typeof window === "undefined") return;
        try {
          window.localStorage.setItem(
            `${COMPANY_BRANDING_CACHE_KEY_PREFIX}${companyId}`,
            JSON.stringify(payload),
          );
        } catch {
          // ignore storage write issues
        }
      };
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
      const memoryBranding = brandingMemoryCacheByCompany[companyId];
      if (memoryBranding) {
        setCompanyThemeColor(memoryBranding.themeColor || "#2F6BFF");
        setCompanyLogoPath(memoryBranding.logoPath || "");
        setCompanyDisplayName(memoryBranding.name || "Company");
        return;
      }
      const cachedBranding = readBrandingCache(companyId);
      if (cachedBranding) {
        if (cachedBranding.themeColor) setCompanyThemeColor(cachedBranding.themeColor);
        setCompanyLogoPath(cachedBranding.logoPath);
        setCompanyDisplayName(cachedBranding.name || "Company");
        brandingMemoryCacheByCompany[companyId] = {
          themeColor: cachedBranding.themeColor || "#2F6BFF",
          logoPath: cachedBranding.logoPath || "",
          name: cachedBranding.name || "Company",
        };
        return;
      }
      const doc = await fetchCompanyDoc(companyId);
      const color = String((doc as Record<string, unknown> | null)?.themeColor ?? "").trim();
      if (color) {
        setCompanyThemeColor(color);
      }
      const logoPath = String((doc as Record<string, unknown> | null)?.logoPath ?? "").trim();
      setCompanyLogoPath(logoPath);
      const name = String((doc as Record<string, unknown> | null)?.name ?? "").trim();
      setCompanyDisplayName(name || "Company");
      writeBrandingCache(companyId, {
        themeColor: color || "#2F6BFF",
        logoPath,
        name: name || "Company",
      });
      brandingMemoryCacheByCompany[companyId] = {
        themeColor: color || "#2F6BFF",
        logoPath,
        name: name || "Company",
      };
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
    if (!showNewProject) return;
    const editor = newProjectNotesEditorRef.current;
    if (!editor) return;
    editor.innerHTML = notesToDisplayHtml(projectNotes);
    resizeNewProjectNotesEditor();
    const onSelectionChange = () => refreshNewProjectNotesToolbarState();
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [showNewProject]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (mobileNavOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileNavOpen]);

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
    setNewProjectNotesParagraphMode(false);
    setNewProjectNotesBulletMode(false);
    setNewProjectNotesBoldActive(false);
    setNewProjectNotesItalicActive(false);
    setNewProjectNotesStrikeActive(false);
    setIsNewProjectNotesFocused(false);
    setNewProjectNotesHeight(88);
    setTagInput("");
    setTags([]);
    setIsTagInputOpen(false);
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
    if (!next) return false;
    let added = false;
    setTags((prev) => {
      const lower = new Set(prev.map((v) => v.toLowerCase()));
      if (lower.has(next.toLowerCase())) return prev;
      added = true;
      return [...prev, next].slice(0, 5);
    });
    setTagInput("");
    return added;
  };

  const removeTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  const NEW_PROJECT_NOTES_BULLET_PREFIX = "\u2022\u00A0";

  const currentNewProjectNotesBlock = () => {
    const editor = newProjectNotesEditorRef.current;
    const sel = window.getSelection();
    if (!editor || !sel || !sel.rangeCount) return null;
    let node: Node | null = sel.getRangeAt(0).startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    if (!node || !(node as HTMLElement).closest) return null;
    const block =
      (node as HTMLElement).closest("div, p, li, blockquote, h1, h2, h3, h4, h5, h6") ||
      (node as HTMLElement);
    if (!editor.contains(block) || block === editor) return null;
    return block as HTMLElement;
  };

  const isCurrentNewProjectNotesLineBullet = () => {
    const block = currentNewProjectNotesBlock();
    if (!block) return false;
    const txt = String(block.textContent || "");
    return /^\s*\u2022(?:\u00A0|\s)/.test(txt);
  };

  const isCurrentNewProjectNotesLineParagraph = () => {
    const block = currentNewProjectNotesBlock();
    if (!block) return false;
    return block.classList.contains("notes-paragraph-line");
  };

  const ensureNewProjectNotesBulletOnCurrentLine = () => {
    const block = currentNewProjectNotesBlock();
    if (!block) return;
    const txt = String(block.textContent ?? "").replace(/\u00A0/g, " ").trimStart();
    if (!txt.startsWith("\u2022")) {
      block.textContent = `${NEW_PROJECT_NOTES_BULLET_PREFIX}${txt}`;
    } else if (!txt.startsWith(NEW_PROJECT_NOTES_BULLET_PREFIX)) {
      block.textContent = txt.replace(/^\u2022(?:\u00A0|\s)*/, NEW_PROJECT_NOTES_BULLET_PREFIX);
    }
  };

  const removeNewProjectNotesBulletPrefixFromCurrentLine = () => {
    const block = currentNewProjectNotesBlock();
    if (!block) return;
    const txt = String(block.textContent ?? "");
    block.textContent = txt.replace(/^\s*\u2022(?:\u00A0|\s)?/, "");
  };

  const isCurrentNewProjectNotesBulletLineEmpty = (): boolean => {
    const block = currentNewProjectNotesBlock();
    if (!block) return false;
    const txt = String(block.textContent ?? "").replace(/\u00A0/g, " ");
    const noBullet = txt.replace(/^\s*\u2022(?:\u00A0|\s)?/, "").trim();
    return noBullet.length === 0;
  };

  const ensureNewProjectNotesParagraphOnCurrentLine = () => {
    const block = currentNewProjectNotesBlock();
    if (!block) return;
    block.classList.add("notes-paragraph-line");
  };

  const insertNextNewProjectNotesBulletLine = () => {
    const editor = newProjectNotesEditorRef.current;
    if (!editor) return;
    const block = currentNewProjectNotesBlock();

    const newBlock = document.createElement("div");
    const textNode = document.createTextNode(NEW_PROJECT_NOTES_BULLET_PREFIX);
    newBlock.appendChild(textNode);
    if ((block as HTMLElement | null)?.classList?.contains("notes-paragraph-line") || newProjectNotesParagraphMode) {
      newBlock.classList.add("notes-paragraph-line");
    }

    if (block && editor.contains(block)) {
      if (block.nextSibling) {
        block.parentNode?.insertBefore(newBlock, block.nextSibling);
      } else {
        block.parentNode?.appendChild(newBlock);
      }
    } else {
      editor.appendChild(newBlock);
    }

    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.setStart(textNode, textNode.length);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  };

  const exitNewProjectNotesParagraphModeOnCurrentLine = () => {
    const block = currentNewProjectNotesBlock();
    if (!block) return;
    block.classList.remove("notes-paragraph-line");
  };

  const placeCaretInNewProjectNotesLine = (block: HTMLElement | null) => {
    if (!block) return;
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    if (!block.firstChild) {
      block.appendChild(document.createElement("br"));
    }
    range.setStart(block, 0);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  const isCurrentNewProjectNotesParagraphLineEmpty = (): boolean => {
    const block = currentNewProjectNotesBlock();
    if (!block) return false;
    if (!block.classList.contains("notes-paragraph-line")) return false;
    const text = String(block.textContent ?? "").replace(/\u00A0/g, " ").trim();
    return text.length === 0;
  };

  const refreshNewProjectNotesToolbarState = () => {
    const editor = newProjectNotesEditorRef.current;
    const sel = window.getSelection();
    const insideEditor =
      !!editor &&
      !!sel &&
      sel.rangeCount > 0 &&
      editor.contains(sel.anchorNode);
    if (!insideEditor) return;
    setNewProjectNotesBulletMode(isCurrentNewProjectNotesLineBullet());
    setNewProjectNotesParagraphMode(isCurrentNewProjectNotesLineParagraph());
    try {
      setNewProjectNotesBoldActive(!!document.queryCommandState("bold"));
      setNewProjectNotesItalicActive(!!document.queryCommandState("italic"));
      setNewProjectNotesStrikeActive(!!document.queryCommandState("strikeThrough"));
    } catch {
      setNewProjectNotesBoldActive(false);
      setNewProjectNotesItalicActive(false);
      setNewProjectNotesStrikeActive(false);
    }
  };

  const applyNewProjectNotesFormat = (command: string) => {
    const editor = newProjectNotesEditorRef.current;
    if (!editor) return;
    editor.focus();
    try {
      document.execCommand(command, false);
    } catch {
      // ignore browser differences
    }
    setProjectNotes(editor.innerHTML);
    window.setTimeout(() => refreshNewProjectNotesToolbarState(), 0);
  };

  const insertNewProjectNotesBullet = () => {
    const editor = newProjectNotesEditorRef.current;
    if (!editor) return;
    try {
      editor.focus();
      const sel = window.getSelection();
      if (!sel) return;
      let range: Range | null = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
      if (!range || !editor.contains(range.commonAncestorContainer)) {
        let lastLine = editor.lastElementChild as HTMLElement | null;
        if (!lastLine || !/^(DIV|P)$/i.test(lastLine.tagName)) {
          lastLine = document.createElement("div");
          lastLine.appendChild(document.createElement("br"));
          editor.appendChild(lastLine);
        }
        const safeRange = document.createRange();
        safeRange.selectNodeContents(lastLine);
        safeRange.collapse(false);
        sel.removeAllRanges();
        sel.addRange(safeRange);
        range = safeRange;
      }

      let block = currentNewProjectNotesBlock();
      if (!block || !editor.contains(block) || block === editor) {
        const line = document.createElement("div");
        line.appendChild(document.createElement("br"));
        editor.appendChild(line);
        block = line;
        const lineRange = document.createRange();
        lineRange.selectNodeContents(block);
        lineRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(lineRange);
      }

      const rawText = String(block.textContent ?? "").replace(/\u00A0/g, " ");
      const plainText = rawText.replace(/^\s*\u2022(?:\u00A0|\s)*/, "");
      block.textContent = `${NEW_PROJECT_NOTES_BULLET_PREFIX}${plainText}`;

      const firstText = block.firstChild;
      const caretRange = document.createRange();
      if (firstText && firstText.nodeType === Node.TEXT_NODE) {
        const fullTextLen = (firstText.textContent || "").length;
        caretRange.setStart(firstText, fullTextLen);
      } else {
        caretRange.selectNodeContents(block);
        caretRange.collapse(false);
      }
      caretRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(caretRange);
    } catch {
      // no-op
    }
    setProjectNotes(editor.innerHTML);
  };

  const toggleNewProjectNotesBulletMode = () => {
    const editor = newProjectNotesEditorRef.current;
    if (!editor) return;
    editor.focus();
    setNewProjectNotesBulletMode((prev) => {
      const next = !prev;
      if (next) {
        ensureNewProjectNotesBulletOnCurrentLine();
      }
      setProjectNotes(editor.innerHTML);
      return next;
    });
    window.setTimeout(() => refreshNewProjectNotesToolbarState(), 0);
  };

  const toggleNewProjectNotesParagraphMode = () => {
    const editor = newProjectNotesEditorRef.current;
    if (!editor) return;
    editor.focus();
    setNewProjectNotesParagraphMode((prev) => {
      const next = !prev;
      if (next) {
        ensureNewProjectNotesParagraphOnCurrentLine();
      }
      setProjectNotes(editor.innerHTML);
      return next;
    });
    window.setTimeout(() => refreshNewProjectNotesToolbarState(), 0);
  };

  const resizeNewProjectNotesEditor = () => {
    const editor = newProjectNotesEditorRef.current;
    if (!editor) return;
    const measured = Math.max(88, editor.scrollHeight + 2);
    setNewProjectNotesHeight(measured);
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

  const modalRowClass =
    "grid items-start gap-2 md:gap-3 [grid-template-columns:minmax(0,1fr)] md:[grid-template-columns:220px_minmax(0,1fr)]";
  const modalLabelClass = "text-[11px] font-bold text-[#475467]";
  const modalSectionLabelClass = "pt-1 md:pt-2 text-[11px] font-bold text-[#475467]";

  return (
    <div className="min-h-screen bg-[var(--bg-app)]">
      <header className="fixed inset-x-0 top-0 z-[80] flex h-14 items-center justify-between border-b border-[var(--panel-border)] bg-white px-3 lg:hidden">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#D8DEE8] text-[#334155]"
            aria-label="Open menu"
          >
            <Menu size={18} />
          </button>
          {isProjectDetailsRoute && (
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-white text-[#334155]"
              aria-label="Back to projects"
              title="Back to projects"
            >
              <img
                src="/angle-left.png"
                alt="Back"
                className="h-4 w-4 object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-[8px] border border-[var(--panel-border)] bg-[var(--brand)] p-1.5 text-white">
            <Building2 size={14} />
          </div>
          <p className="text-[12px] font-bold text-[var(--text-main)]">CutSmart</p>
        </div>
        <button
          type="button"
          onClick={() => setShowNewProject(true)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#159947] bg-[#22C55E] text-white hover:bg-[#16A34A]"
          aria-label="New project"
        >
          <Plus size={20} strokeWidth={2.8} />
        </button>
      </header>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-[120] lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-[rgba(15,23,42,0.45)]"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close menu backdrop"
          />
          <aside className="relative z-[121] flex h-full w-[260px] flex-col overflow-hidden border-r border-[var(--panel-border)] bg-white">
            <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-4 py-3">
              <div className="flex min-h-[44px] items-center">
                {companyLogoPath ? (
                  <img
                    src={companyLogoPath}
                    alt={`${companyDisplayName} logo`}
                    className="block h-[42px] w-auto object-contain"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : companyDisplayName ? (
                  <p className="text-[13px] font-semibold text-[var(--text-main)]">{companyDisplayName}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#D8DEE8] text-[#475467]"
                aria-label="Close menu"
              >
                <X size={15} />
              </button>
            </div>

            <div className="flex min-h-0 h-full flex-1 flex-col px-3 py-3">
              <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowNewProject(true);
                    setMobileNavOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-[10px] border border-transparent px-3 py-2 text-left text-[13px] font-bold text-[#475467] transition hover:border-[#E4E7EC] hover:bg-[#F7F8FC]"
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
                        "flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[13px] font-bold transition",
                        active
                          ? "border-[var(--panel-border)] bg-[var(--panel-muted)] text-[#475467]"
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
                        "flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[13px] font-bold transition",
                        active
                          ? "border-[var(--panel-border)] bg-[var(--panel-muted)] text-[#475467]"
                          : "border-transparent text-[#475467] hover:border-[#E4E7EC] hover:bg-[#F7F8FC]",
                      )}
                    >
                      <Icon size={16} />
                      {item.label}
                    </Link>
                  );
                })}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full justify-start text-[13px] font-bold text-[#475467] hover:bg-[#F7F8FC] hover:text-[#475467]"
                  onClick={() => void logout()}
                >
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
              </div>
            </div>
          </aside>
        </div>
      )}

      <aside
        className="z-[70] hidden w-[230px] flex-col overflow-hidden border-r border-[var(--panel-border)] bg-white lg:flex"
        style={{ position: "fixed", left: 0, top: 0, height: "100vh" }}
      >
        <div className="border-b border-[var(--panel-border)] px-4 py-3">
          <div className="flex min-h-[44px] items-center">
            {companyLogoPath ? (
              <img
                src={companyLogoPath}
                alt={`${companyDisplayName} logo`}
                className="block h-[42px] w-auto object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : companyDisplayName ? (
              <p className="text-[13px] font-semibold text-[var(--text-main)]">{companyDisplayName}</p>
            ) : null}
          </div>
        </div>

        <div className="flex min-h-0 h-full flex-1 flex-col px-3 py-3">
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            <button
              type="button"
              onClick={() => setShowNewProject(true)}
              className="flex w-full items-center gap-2 rounded-[10px] border border-transparent px-3 py-2 text-left text-[13px] font-bold text-[#475467] transition hover:border-[#E4E7EC] hover:bg-[#F7F8FC]"
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
                    "flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[13px] font-bold transition",
                    active
                      ? "border-[var(--panel-border)] bg-[var(--panel-muted)] text-[#475467]"
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
                    "flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[13px] font-bold transition",
                    active
                      ? "border-[var(--panel-border)] bg-[var(--panel-muted)] text-[#475467]"
                      : "border-transparent text-[#475467] hover:border-[#E4E7EC] hover:bg-[#F7F8FC]",
                  )}
                >
                  <Icon size={16} />
                  {item.label}
                </Link>
              );
            })}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-start text-[13px] font-bold text-[#475467] hover:bg-[#F7F8FC] hover:text-[#475467]"
              onClick={() => void logout()}
            >
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
        className="min-w-0 overflow-x-hidden pt-14 lg:pt-0"
        style={{ width: "100%", paddingLeft: 0 }}
      >
        <main className="min-w-0 overflow-x-clip px-3 py-3 md:px-4 md:py-4 lg:px-5 lg:py-4" style={{ paddingLeft: "max(12px, env(safe-area-inset-left))", paddingRight: "max(12px, env(safe-area-inset-right))", marginLeft: "0" }}>
          <div className="lg:ml-[230px]">{children}</div>
        </main>
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
            className="relative flex flex-col overflow-hidden rounded-[14px] border border-[#D7DEE8] bg-white p-3 shadow-xl sm:p-4"
            style={{ width: "min(1000px, calc(100vw - 16px))", height: "min(600px, calc(100vh - 16px))" }}
          >
            <p className="text-[15px] font-extrabold uppercase tracking-[1px] text-[#12345B]">New Project</p>
            <div className="relative mt-3 flex-1 space-y-3 overflow-y-auto pr-0 sm:pr-1">
              <div className={modalRowClass}>
                <p className={modalLabelClass}>Project Name</p>
                <input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className="h-9 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                  placeholder="Project name"
                />
              </div>
              <div className={modalRowClass}>
                <p className={modalLabelClass}>Client Name</p>
                <input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className="h-9 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                  placeholder="Client name"
                />
              </div>
              <div className={modalRowClass}>
                <p className={modalLabelClass}>Client Phone</p>
                <input
                  value={clientPhone}
                  onChange={(e) => setClientPhone(formatMobileLikeDesktop(e.target.value))}
                  className="h-9 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                  placeholder="021 234 5678"
                />
              </div>
              <div className={modalRowClass}>
                <p className={modalLabelClass}>Client Email</p>
                <input
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  className="h-9 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                  placeholder="client@email.com"
                />
              </div>
              <div className={modalRowClass}>
                <p className={modalLabelClass}>Project Address</p>
                <input
                  value={projectAddress}
                  onChange={(e) => setProjectAddress(e.target.value)}
                  className="h-9 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                  placeholder="Street, suburb, city"
                />
              </div>
              {projectAddress.trim().length > 5 && (
                <div className={modalRowClass}>
                  <div className="hidden md:block" />
                  <div className="overflow-hidden rounded-[10px] border border-[#D8DEE8]">
                    <iframe
                      title="Address preview"
                      className="h-[170px] w-full border-0"
                      src={`https://maps.google.com/maps?q=${encodeURIComponent(projectAddress.trim())}&t=&z=13&ie=UTF8&iwloc=&output=embed`}
                    />
                  </div>
                </div>
              )}
              <div className={modalRowClass}>
                <p className={modalSectionLabelClass}>Tags</p>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    {tags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="inline-flex items-center gap-1 rounded-[8px] border border-[#D6DEE9] bg-[#EEF2F7] px-2 py-[2px] text-[12px] font-semibold text-[#7B8798] hover:bg-[#FDECEC] hover:text-[#B42318]"
                        title="Delete tag"
                      >
                        <Tag size={11} />
                        {tag}
                      </button>
                    ))}
                    {tags.length < 5 && isTagInputOpen && (
                      <input
                        ref={newProjectTagInputRef}
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === ",") {
                            e.preventDefault();
                            const added = addTag(tagInput);
                            if (added) {
                              window.setTimeout(() => newProjectTagInputRef.current?.focus(), 0);
                            }
                          }
                          if (e.key === "Escape") {
                            setTagInput("");
                            setIsTagInputOpen(false);
                          }
                        }}
                        className="h-7 w-[120px] rounded-[8px] border border-[#D6DEE9] bg-white px-2 text-[12px] text-[#334155] outline-none"
                        placeholder="Tag"
                        list="new-project-tag-suggestions"
                      />
                    )}
                    {tags.length < 5 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!isTagInputOpen) {
                            setIsTagInputOpen(true);
                            window.setTimeout(() => newProjectTagInputRef.current?.focus(), 0);
                            return;
                          }
                          const added = addTag(tagInput);
                          if (added) {
                            window.setTimeout(() => newProjectTagInputRef.current?.focus(), 0);
                          }
                        }}
                        className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-[8px] border border-[#D6DEE9] bg-[#EEF2F7] text-[#64748B] hover:bg-[#E2E8F0]"
                        aria-label="Add tag"
                      >
                        <Plus size={14} />
                      </button>
                    )}
                  </div>
                  {!!companyTagSuggestions.length && (
                    <datalist id="new-project-tag-suggestions">
                      {companyTagSuggestions.map((tag) => (
                        <option key={tag} value={tag} />
                      ))}
                    </datalist>
                  )}
                </div>
              </div>
              <div className={modalRowClass}>
                <p className={modalSectionLabelClass}>Notes</p>
                <div
                  ref={newProjectNotesContainerRef}
                  className="w-full"
                  onFocusCapture={() => setIsNewProjectNotesFocused(true)}
                  onBlurCapture={(e) => {
                    const next = e.relatedTarget as Node | null;
                    if (next && newProjectNotesContainerRef.current?.contains(next)) return;
                    setIsNewProjectNotesFocused(false);
                  }}
                >
                  <div className="relative">
                    {isNewProjectNotesFocused && (
                      <div className="absolute inset-x-0 top-0 z-10 flex h-8 items-center gap-1 rounded-t-[8px] border-b border-[#D8DEE8] bg-[#F8FAFC] px-2">
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => applyNewProjectNotesFormat("bold")}
                          className={`inline-flex h-6 min-w-[24px] items-center justify-center rounded-[6px] border px-2 text-[12px] font-semibold ${
                            newProjectNotesBoldActive
                              ? "border-[#2F6BFF] bg-[#2F6BFF] text-white"
                              : "border-[#D6DEE9] bg-white text-black"
                          }`}
                          title="Bold"
                        >
                          B
                        </button>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => applyNewProjectNotesFormat("italic")}
                          className={`inline-flex h-6 min-w-[24px] items-center justify-center rounded-[6px] border px-2 text-[12px] font-semibold ${
                            newProjectNotesItalicActive
                              ? "border-[#2F6BFF] bg-[#2F6BFF] text-white"
                              : "border-[#D6DEE9] bg-white text-black"
                          }`}
                          title="Italic"
                        >
                          I
                        </button>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => applyNewProjectNotesFormat("strikeThrough")}
                          className={`inline-flex h-6 min-w-[24px] items-center justify-center rounded-[6px] border px-2 text-[12px] font-semibold ${
                            newProjectNotesStrikeActive
                              ? "border-[#2F6BFF] bg-[#2F6BFF] text-white"
                              : "border-[#D6DEE9] bg-white text-black"
                          }`}
                          title="Strikethrough"
                        >
                          S
                        </button>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            if (newProjectNotesBulletMode) {
                              setNewProjectNotesBulletMode(false);
                            } else {
                              insertNewProjectNotesBullet();
                              setNewProjectNotesBulletMode(true);
                            }
                            window.setTimeout(() => refreshNewProjectNotesToolbarState(), 0);
                          }}
                          className={`inline-flex h-6 min-w-[24px] items-center justify-center rounded-[6px] border px-1 ${
                            newProjectNotesBulletMode
                              ? "border-[#2F6BFF] bg-[#2F6BFF]"
                              : "border-[#D6DEE9] bg-white"
                          }`}
                          title="Bulleted row"
                        >
                          <img
                            src="/bulletpoint.png"
                            alt="Bullet"
                            className="h-3 w-3 object-contain"
                            style={{ filter: newProjectNotesBulletMode ? "brightness(0) invert(1)" : "none" }}
                          />
                        </button>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={toggleNewProjectNotesParagraphMode}
                          className={`inline-flex h-6 min-w-[24px] items-center justify-center rounded-[6px] border px-1 ${
                            newProjectNotesParagraphMode
                              ? "border-[#2F6BFF] bg-[#2F6BFF]"
                              : "border-[#D6DEE9] bg-white"
                          }`}
                          title="Paragraph indent"
                        >
                          <img
                            src="/paragraph.png"
                            alt="Paragraph"
                            className="h-3 w-3 object-contain"
                            style={{ filter: newProjectNotesParagraphMode ? "brightness(0) invert(1)" : "none" }}
                          />
                        </button>
                      </div>
                    )}
                    {notesHtmlIsEmpty(projectNotes) && (
                      <p className="pointer-events-none absolute left-2 text-[12px] text-[#98A2B3]" style={{ top: isNewProjectNotesFocused ? 34 : 8 }}>
                        Project notes...
                      </p>
                    )}
                    <div
                      ref={newProjectNotesEditorRef}
                      contentEditable
                      suppressContentEditableWarning
                      onFocus={() =>
                        window.setTimeout(() => {
                          refreshNewProjectNotesToolbarState();
                          resizeNewProjectNotesEditor();
                        }, 0)
                      }
                      onInput={(e) => {
                        if (newProjectNotesParagraphMode) {
                          ensureNewProjectNotesParagraphOnCurrentLine();
                        }
                        const editor = e.currentTarget;
                        setProjectNotes(editor.innerHTML);
                        resizeNewProjectNotesEditor();
                        window.setTimeout(() => refreshNewProjectNotesToolbarState(), 0);
                      }}
                      onKeyDown={(e) => {
                        const editor = newProjectNotesEditorRef.current;
                        if (!editor) return;
                        if (e.key !== "Enter") {
                          newProjectNotesLastEnterAtRef.current = 0;
                          if (newProjectNotesParagraphMode) {
                            ensureNewProjectNotesParagraphOnCurrentLine();
                          }
                          window.setTimeout(() => refreshNewProjectNotesToolbarState(), 0);
                          return;
                        }
                        if (newProjectNotesBulletMode) {
                          if (isCurrentNewProjectNotesBulletLineEmpty()) {
                            e.preventDefault();
                            const currentBlock = currentNewProjectNotesBlock();
                            setNewProjectNotesBulletMode(false);
                            setNewProjectNotesParagraphMode(false);
                            newProjectNotesLastEnterAtRef.current = 0;
                            removeNewProjectNotesBulletPrefixFromCurrentLine();
                            exitNewProjectNotesParagraphModeOnCurrentLine();
                            if (currentBlock) {
                              currentBlock.innerHTML = "";
                              currentBlock.appendChild(document.createElement("br"));
                            }
                            placeCaretInNewProjectNotesLine(currentBlock);
                            setProjectNotes(editor.innerHTML);
                            resizeNewProjectNotesEditor();
                            window.setTimeout(() => refreshNewProjectNotesToolbarState(), 0);
                            return;
                          }
                          e.preventDefault();
                          insertNextNewProjectNotesBulletLine();
                          setProjectNotes(editor.innerHTML);
                          resizeNewProjectNotesEditor();
                          newProjectNotesLastEnterAtRef.current = Date.now();
                          window.setTimeout(() => refreshNewProjectNotesToolbarState(), 0);
                          return;
                        }
                        if (!newProjectNotesParagraphMode) {
                          newProjectNotesLastEnterAtRef.current = Date.now();
                          return;
                        }
                        if (isCurrentNewProjectNotesParagraphLineEmpty()) {
                          e.preventDefault();
                          setNewProjectNotesParagraphMode(false);
                          newProjectNotesLastEnterAtRef.current = 0;
                          exitNewProjectNotesParagraphModeOnCurrentLine();
                          setProjectNotes(editor.innerHTML);
                          resizeNewProjectNotesEditor();
                          window.setTimeout(() => refreshNewProjectNotesToolbarState(), 0);
                          return;
                        }
                        const now = Date.now();
                        if (now - newProjectNotesLastEnterAtRef.current <= 800) {
                          e.preventDefault();
                          setNewProjectNotesParagraphMode(false);
                          newProjectNotesLastEnterAtRef.current = 0;
                          exitNewProjectNotesParagraphModeOnCurrentLine();
                          setProjectNotes(editor.innerHTML);
                          resizeNewProjectNotesEditor();
                          window.setTimeout(() => refreshNewProjectNotesToolbarState(), 0);
                          return;
                        }
                        e.preventDefault();
                        try {
                          document.execCommand("insertHTML", false, "<div class=\"notes-paragraph-line\"><br></div>");
                        } catch {
                          // no-op
                        }
                        newProjectNotesLastEnterAtRef.current = now;
                        setProjectNotes(editor.innerHTML);
                        resizeNewProjectNotesEditor();
                        window.setTimeout(() => refreshNewProjectNotesToolbarState(), 0);
                      }}
                      className="notes-rich min-h-[88px] w-full overflow-hidden rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px] text-[#2F3F56] focus:outline-none"
                      style={{
                        paddingTop: isNewProjectNotesFocused ? 34 : 8,
                        paddingBottom: 8,
                        height: newProjectNotesHeight,
                      }}
                    />
                  </div>
                </div>
              </div>
              <div className={modalRowClass}>
                <p className={modalSectionLabelClass}>Photos (max 5)</p>
                <div
                  className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
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
                <div className={modalRowClass}>
                  <p className={modalSectionLabelClass}>Assign Project To</p>
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
            <div className="mt-4 flex flex-col-reverse items-stretch justify-end gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => {
                  setShowNewProject(false);
                  resetProjectForm();
                }}
                className="h-9 rounded-[9px] border border-[#D8DEE8] bg-white px-3 text-[12px] font-bold text-[#334155] sm:w-auto"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={creatingProject}
                onClick={() => void onCreateProject()}
                className="h-9 rounded-[9px] border border-[#C8DAFF] bg-[#EAF1FF] px-3 text-[12px] font-bold text-[#24589A] disabled:opacity-55 sm:w-auto"
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
