import { randomBytes } from "node:crypto";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  GlobalRole,
  UserStatus,
  ProjectRole,
  TaskType,
  TaskStatus,
  TaskPriority,
} from "../src/generated/prisma/client";

// Prisma 7 no longer auto-loads .env; Next keeps secrets in .env.local. Load both
// (best-effort) so a plain `prisma db seed` / `tsx prisma/seed.ts` finds DATABASE_URL.
for (const file of [".env", ".env.local"]) {
  try {
    process.loadEnvFile(path.resolve(process.cwd(), file));
  } catch {
    // File may not exist — ignore.
  }
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const BCRYPT_ROUNDS = 12;

interface TaskSpec {
  key: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  assigned: boolean;
  labels: string[];
  parentKey?: string;
  dueInDays?: number;
}

// 8 top-level tasks spanning all four statuses + varied type/priority, then 2 subtasks.
const TASK_SPECS: TaskSpec[] = [
  {
    key: "FLUX-1",
    title: "Set up authentication with Auth.js",
    type: TaskType.STORY,
    status: TaskStatus.IN_PROGRESS,
    priority: TaskPriority.HIGH,
    assigned: true,
    labels: ["backend"],
  },
  {
    key: "FLUX-2",
    title: "Design the Kanban board layout",
    type: TaskType.TASK,
    status: TaskStatus.TODO,
    priority: TaskPriority.MEDIUM,
    assigned: false,
    labels: ["frontend"],
    dueInDays: 7,
  },
  {
    key: "FLUX-3",
    title: "Fix drag-and-drop flicker on Safari",
    type: TaskType.BUG,
    status: TaskStatus.IN_REVIEW,
    priority: TaskPriority.URGENT,
    assigned: true,
    labels: ["frontend", "bug"],
    dueInDays: 1,
  },
  {
    key: "FLUX-4",
    title: "Implement per-project role checks",
    type: TaskType.STORY,
    status: TaskStatus.TODO,
    priority: TaskPriority.HIGH,
    assigned: false,
    labels: ["backend"],
    dueInDays: 3,
  },
  {
    key: "FLUX-5",
    title: "Wire up R2 presigned uploads",
    type: TaskType.TASK,
    status: TaskStatus.IN_PROGRESS,
    priority: TaskPriority.MEDIUM,
    assigned: true,
    labels: ["backend"],
  },
  {
    key: "FLUX-6",
    title: "Build the dashboard KPI cards",
    type: TaskType.STORY,
    status: TaskStatus.DONE,
    priority: TaskPriority.MEDIUM,
    assigned: false,
    labels: ["frontend"],
    dueInDays: -2,
  },
  {
    key: "FLUX-7",
    title: "Add rich-text comments with Tiptap",
    type: TaskType.TASK,
    status: TaskStatus.TODO,
    priority: TaskPriority.LOW,
    assigned: false,
    labels: ["frontend"],
  },
  {
    key: "FLUX-8",
    title: "Audit log for admin actions",
    type: TaskType.TASK,
    status: TaskStatus.DONE,
    priority: TaskPriority.HIGH,
    assigned: true,
    labels: ["backend"],
    dueInDays: -5,
  },
  // Subtasks of FLUX-1
  {
    key: "FLUX-9",
    title: "Add credentials provider",
    type: TaskType.TASK,
    status: TaskStatus.IN_PROGRESS,
    priority: TaskPriority.MEDIUM,
    assigned: true,
    labels: ["backend"],
    parentKey: "FLUX-1",
  },
  {
    key: "FLUX-10",
    title: "Harden session cookies",
    type: TaskType.TASK,
    status: TaskStatus.TODO,
    priority: TaskPriority.HIGH,
    assigned: false,
    labels: ["backend"],
    parentKey: "FLUX-1",
  },
];

const LABELS: { name: string; color: string }[] = [
  { name: "backend", color: "#5B8DEF" }, // --info
  { name: "frontend", color: "#3CCF91" }, // --success
  { name: "bug", color: "#F5455C" }, // --danger
];

// Fractional board ordering: hand out increasing positions per status column.
const positionByStatus = new Map<TaskStatus, number>();
function nextPosition(status: TaskStatus): number {
  const next = (positionByStatus.get(status) ?? 0) + 1024;
  positionByStatus.set(status, next);
  return next;
}

function dueDateFrom(days?: number): Date | null {
  if (days === undefined) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function main() {
  // ── Admin user ──────────────────────────────────────────────────────────
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "it@iccadubai.ae").toLowerCase();
  const providedPassword = process.env.SEED_ADMIN_PASSWORD;

  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });

  // Only (re)set a password when one is explicitly provided, or when creating the
  // admin for the first time (generate a strong random one). Re-runs otherwise
  // leave the existing password untouched so the account never gets locked out.
  let reportPassword: string | null = null;
  let newHash: string | null = null;
  if (providedPassword) {
    newHash = await bcrypt.hash(providedPassword, BCRYPT_ROUNDS);
    reportPassword = providedPassword;
  } else if (!existingAdmin) {
    const generated = randomBytes(15).toString("base64url");
    newHash = await bcrypt.hash(generated, BCRYPT_ROUNDS);
    reportPassword = generated;
  }
  const createHash =
    newHash ??
    existingAdmin?.hashedPassword ??
    (await bcrypt.hash(randomBytes(15).toString("base64url"), BCRYPT_ROUNDS));

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      name: "Flux Admin",
      globalRole: GlobalRole.ADMIN,
      status: UserStatus.ACTIVE,
      ...(newHash ? { hashedPassword: newHash } : {}),
    },
    create: {
      email: adminEmail,
      username: "admin",
      name: "Flux Admin",
      hashedPassword: createHash,
      globalRole: GlobalRole.ADMIN,
      status: UserStatus.ACTIVE,
      bio: "Platform administrator.",
    },
  });

  // ── Demo project ────────────────────────────────────────────────────────
  const project = await prisma.project.upsert({
    where: { key: "FLUX" },
    update: { name: "Flux", description: "Internal task & project management.", leadId: admin.id },
    create: {
      key: "FLUX",
      name: "Flux",
      description: "Internal task & project management.",
      leadId: admin.id,
    },
  });

  // ── Admin as project MANAGER ─────────────────────────────────────────────
  await prisma.projectMembership.upsert({
    where: { projectId_userId: { projectId: project.id, userId: admin.id } },
    update: { projectRole: ProjectRole.MANAGER },
    create: { projectId: project.id, userId: admin.id, projectRole: ProjectRole.MANAGER },
  });

  // ── Labels ───────────────────────────────────────────────────────────────
  const labelsByName = new Map<string, { id: string }>();
  for (const l of LABELS) {
    const label = await prisma.label.upsert({
      where: { projectId_name: { projectId: project.id, name: l.name } },
      update: { color: l.color },
      create: { projectId: project.id, name: l.name, color: l.color },
    });
    labelsByName.set(l.name, label);
  }

  // ── Tasks (parents before subtasks) ──────────────────────────────────────
  const tasksByKey = new Map<string, { id: string }>();
  for (const spec of TASK_SPECS) {
    const labelConnect = spec.labels
      .map((name) => labelsByName.get(name))
      .filter((l): l is { id: string } => Boolean(l))
      .map((l) => ({ id: l.id }));
    const parentId = spec.parentKey ? (tasksByKey.get(spec.parentKey)?.id ?? null) : null;
    const assigneeId = spec.assigned ? admin.id : null;
    const dueDate = dueDateFrom(spec.dueInDays);

    const task = await prisma.task.upsert({
      where: { key: spec.key },
      update: {
        title: spec.title,
        type: spec.type,
        status: spec.status,
        priority: spec.priority,
        assigneeId,
        parentId,
        dueDate,
        labels: { set: labelConnect },
      },
      create: {
        key: spec.key,
        projectId: project.id,
        title: spec.title,
        type: spec.type,
        status: spec.status,
        priority: spec.priority,
        reporterId: admin.id,
        assigneeId,
        parentId,
        position: nextPosition(spec.status),
        dueDate,
        labels: { connect: labelConnect },
      },
    });
    tasksByKey.set(spec.key, task);
  }

  // Keep the per-project key counter ahead of the seeded tasks.
  await prisma.project.update({
    where: { id: project.id },
    data: { taskCounter: TASK_SPECS.length },
  });

  // ── One comment ──────────────────────────────────────────────────────────
  const flux3 = tasksByKey.get("FLUX-3");
  if (flux3) {
    const existingComment = await prisma.comment.findFirst({
      where: { taskId: flux3.id, authorId: admin.id },
    });
    if (!existingComment) {
      await prisma.comment.create({
        data: {
          taskId: flux3.id,
          authorId: admin.id,
          body: "<p>Reproduced on Safari 17 — looks like a transform lag during the drag.</p>",
        },
      });
    }
  }

  // ── Activity log entries (only if none exist yet, to stay idempotent) ─────
  if ((await prisma.activityLog.count()) === 0) {
    const flux1 = tasksByKey.get("FLUX-1");
    const flux6 = tasksByKey.get("FLUX-6");
    const flux8 = tasksByKey.get("FLUX-8");
    const entries = [
      flux1 && { taskId: flux1.id, actorId: admin.id, action: "created" },
      flux1 && {
        taskId: flux1.id,
        actorId: admin.id,
        action: "updated",
        field: "status",
        oldValue: TaskStatus.TODO,
        newValue: TaskStatus.IN_PROGRESS,
      },
      flux3 && {
        taskId: flux3.id,
        actorId: admin.id,
        action: "updated",
        field: "priority",
        oldValue: TaskPriority.HIGH,
        newValue: TaskPriority.URGENT,
      },
      flux6 && {
        taskId: flux6.id,
        actorId: admin.id,
        action: "updated",
        field: "status",
        oldValue: TaskStatus.IN_REVIEW,
        newValue: TaskStatus.DONE,
      },
      flux8 && {
        taskId: flux8.id,
        actorId: admin.id,
        action: "updated",
        field: "status",
        oldValue: TaskStatus.IN_PROGRESS,
        newValue: TaskStatus.DONE,
      },
    ].filter((e): e is NonNullable<typeof e> => Boolean(e));
    await prisma.activityLog.createMany({ data: entries });
  }

  // ── One audit-trail entry for the membership grant (idempotent) ──────────
  const existingAudit = await prisma.auditLog.findFirst({
    where: { action: "project.member.grant", targetId: project.id },
  });
  if (!existingAudit) {
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "project.member.grant",
        targetType: "ProjectMembership",
        targetId: project.id,
        metadata: { userId: admin.id, projectRole: ProjectRole.MANAGER },
      },
    });
  }

  // ── Report ────────────────────────────────────────────────────────────────
  console.log("\n─── Flux seed complete ───");
  console.log(`Project:        FLUX (${TASK_SPECS.length} tasks, ${LABELS.length} labels)`);
  console.log(`Admin email:    ${adminEmail}`);
  console.log(`Admin username: admin`);
  if (reportPassword) {
    console.log(`Admin password: ${reportPassword}`);
    if (!providedPassword) {
      console.log("(auto-generated — set SEED_ADMIN_PASSWORD to choose your own)");
    }
  } else {
    console.log("Admin password: (unchanged — set SEED_ADMIN_PASSWORD to reset it)");
  }
  console.log("──────────────────────────\n");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
