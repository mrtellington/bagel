import { config } from "../../config.js";

const ASANA_BASE = "https://app.asana.com/api/1.0";

async function asanaFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${ASANA_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.asanaPat}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[asana] API error ${res.status}: ${body}`);
    throw new Error(`Asana API error ${res.status}`);
  }
  return res.json();
}

export async function createTask(task: {
  name: string;
  notes?: string;
  due_on?: string;
  assignee?: string;
  projects?: string[];
}) {
  const result = await asanaFetch("/tasks", {
    method: "POST",
    body: JSON.stringify({
      data: {
        ...task,
        projects: task.projects ?? [config.asanaProjectGid],
      },
    }),
  });
  return result.data;
}

export async function updateTask(taskGid: string, updates: Record<string, unknown>) {
  const result = await asanaFetch(`/tasks/${taskGid}`, {
    method: "PUT",
    body: JSON.stringify({ data: updates }),
  });
  return result.data;
}

export async function addTaskToSection(taskGid: string, sectionGid: string) {
  await asanaFetch(`/sections/${sectionGid}/addTask`, {
    method: "POST",
    body: JSON.stringify({ data: { task: taskGid } }),
  });
}

export async function searchTasks(query: string) {
  const result = await asanaFetch(
    `/workspaces/${config.asanaWorkspaceGid}/tasks/search?text=${encodeURIComponent(query)}&opt_fields=name,completed,assignee.name,due_on,projects.name&limit=10`
  );
  return result.data ?? [];
}

export async function addComment(taskGid: string, text: string) {
  await asanaFetch(`/tasks/${taskGid}/stories`, {
    method: "POST",
    body: JSON.stringify({ data: { text } }),
  });
}

export async function findUserByEmail(email: string) {
  try {
    const result = await asanaFetch(
      `/workspaces/${config.asanaWorkspaceGid}/users?opt_fields=name,email`
    );
    const users = result.data ?? [];
    return users.find(
      (u: { email: string }) => u.email.toLowerCase() === email.toLowerCase()
    );
  } catch {
    return null;
  }
}
