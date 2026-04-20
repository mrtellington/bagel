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
    throw new Error(`Asana API error ${res.status}: ${body}`);
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
    `/workspaces/1201405786124364/tasks/search?text=${encodeURIComponent(query)}&opt_fields=name,completed,assignee.name,due_on,projects.name&limit=10`
  );
  return result.data ?? [];
}

/**
 * Fetch Tod's incomplete tasks from Asana, optionally filtered by due-date window.
 * Uses /tasks with assignee=me + workspace + completed_since=now (returns incomplete only).
 * Date filtering is client-side because /tasks doesn't support due_on range params.
 */
export async function getMyTasks(opts?: {
  dueBefore?: string;  // YYYY-MM-DD inclusive
  dueAfter?: string;   // YYYY-MM-DD inclusive
  includeCompleted?: boolean;
}) {
  const params = new URLSearchParams({
    assignee: "me",
    workspace: "1201405786124364",
    opt_fields: "name,due_on,due_at,projects.name,assignee.name,completed",
    limit: "100",
  });
  if (!opts?.includeCompleted) {
    params.set("completed_since", "now");
  }

  const result = await asanaFetch(`/tasks?${params}`);
  let tasks: Array<{ due_on?: string | null; [k: string]: unknown }> = result.data ?? [];

  if (opts?.dueBefore) {
    tasks = tasks.filter((t) => t.due_on && t.due_on <= opts.dueBefore!);
  }
  if (opts?.dueAfter) {
    tasks = tasks.filter((t) => t.due_on && t.due_on >= opts.dueAfter!);
  }

  return tasks;
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
      `/workspaces/1201405786124364/users?opt_fields=name,email`
    );
    const users = result.data ?? [];
    return users.find(
      (u: { email: string }) => u.email.toLowerCase() === email.toLowerCase()
    );
  } catch {
    return null;
  }
}
