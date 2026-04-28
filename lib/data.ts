import { mockChanges, mockCompany, mockCutlists, mockProjects, mockQuotes } from "@/lib/mock-data";

export function listProjects(search?: string, status?: string) {
  return mockProjects.filter((project) => {
    const matchesSearch =
      !search ||
      project.name.toLowerCase().includes(search.toLowerCase()) ||
      project.customer.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !status || status === "all" || project.status === status;
    return matchesSearch && matchesStatus;
  });
}

export function getProject(projectId: string) {
  return mockProjects.find((project) => project.id === projectId) ?? null;
}

export function getProjectChanges(projectId: string) {
  return mockChanges.filter((change) => change.projectId === projectId);
}

export function getProjectQuotes(projectId: string) {
  return mockQuotes.filter((quote) => quote.projectId === projectId);
}

export function getProjectCutlists(projectId: string) {
  return mockCutlists.filter((cutlist) => cutlist.projectId === projectId);
}

export const company = mockCompany;
