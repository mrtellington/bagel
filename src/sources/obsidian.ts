import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "fs";
import { join, relative, extname, dirname } from "path";
import { config } from "../config.js";

export interface ObsidianNote {
  filePath: string;       // relative to vault root, e.g. "00-inbox/2026-04-16-article.md"
  title: string;
  source?: string;        // URL if captured from web
  capturedAt?: string;    // YYYY-MM-DD
  tags: string[];
  status: string;         // inbox | processed
  bagelProcessed: boolean;
  body: string;           // markdown content without frontmatter
  frontmatter: Record<string, unknown>;
}

export function pullVault(): boolean {
  const localPath = config.obsidianLocalPath;

  if (!existsSync(join(localPath, ".git"))) {
    console.log("[obsidian] Cloning vault repo...");
    execFileSync("git", ["clone", config.obsidianRepoUrl, localPath], {
      stdio: "pipe",
      timeout: 60_000,
    });
    return true;
  }

  try {
    const result = execFileSync("git", ["pull", "--ff-only"], {
      cwd: localPath,
      encoding: "utf-8",
      timeout: 30_000,
    });
    const upToDate = result.includes("Already up to date");
    if (!upToDate) {
      console.log("[obsidian] Pulled new changes");
    }
    return !upToDate;
  } catch (err) {
    console.error("[obsidian] Git pull failed:", err);
    return false;
  }
}

export function parseNote(filePath: string): ObsidianNote {
  const fullPath = join(config.obsidianLocalPath, filePath);
  const raw = readFileSync(fullPath, "utf-8");
  const { frontmatter, body } = parseFrontmatter(raw);

  return {
    filePath,
    title: (frontmatter.title as string) ?? fileNameToTitle(filePath),
    source: frontmatter.source as string | undefined,
    capturedAt: frontmatter.captured as string | undefined,
    tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : [],
    status: (frontmatter.status as string) ?? "inbox",
    bagelProcessed: frontmatter["bagel-processed"] === true,
    body,
    frontmatter,
  };
}

export function listVaultFiles(): string[] {
  const files: string[] = [];
  const skipDirs = new Set([".obsidian", ".git", "templates", "node_modules"]);

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (skipDirs.has(entry)) continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (extname(entry) === ".md") {
        files.push(relative(config.obsidianLocalPath, full));
      }
    }
  }

  walk(config.obsidianLocalPath);
  return files;
}

export function getInboxNotes(): ObsidianNote[] {
  return listVaultFiles()
    .filter((f) => f.startsWith("00-inbox/"))
    .map(parseNote)
    .filter((n) => !n.bagelProcessed);
}

export function commitAndPush(filePath: string, content: string): void {
  const fullPath = join(config.obsidianLocalPath, filePath);

  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf-8");

  const cwd = config.obsidianLocalPath;
  try {
    execFileSync("git", ["add", filePath], { cwd, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", `bagel: ${filePath}`], { cwd, stdio: "pipe" });
    execFileSync("git", ["push"], { cwd, stdio: "pipe", timeout: 30_000 });
    console.log(`[obsidian] Committed and pushed: ${filePath}`);
  } catch (err) {
    console.error(`[obsidian] Git commit/push failed for ${filePath}:`, err);
    throw err;
  }
}

export function updateNoteFrontmatter(
  filePath: string,
  updates: Record<string, unknown>
): void {
  const note = parseNote(filePath);
  const merged = { ...note.frontmatter, ...updates };
  const content = serializeFrontmatter(merged) + note.body;
  commitAndPush(filePath, content);
}

// --- Internal helpers ---

function parseFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };

  const yamlBlock = match[1];
  const body = match[2];

  const frontmatter: Record<string, unknown> = {};
  for (const line of yamlBlock.split("\n")) {
    const kv = line.match(/^(\S+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, rawValue] = kv;
    let value: unknown = rawValue.trim();

    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    }
    else if (value === "true") value = true;
    else if (value === "false") value = false;
    else if (
      typeof value === "string" &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

function serializeFrontmatter(fm: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fm)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => String(v)).join(", ")}]`);
    } else if (typeof value === "boolean") {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === "string" && value.includes(":")) {
      lines.push(`${key}: "${value}"`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  lines.push("---\n");
  return lines.join("\n");
}

function fileNameToTitle(filePath: string): string {
  const name = filePath.split("/").pop() ?? filePath;
  return name
    .replace(/\.md$/, "")
    .replace(/^\d{4}-\d{2}-\d{2}(-\d{4})?-/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
