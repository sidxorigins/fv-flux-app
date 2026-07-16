"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"

import { RichTextEditor } from "@/components/editor"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Label as ProjectLabel, User } from "@/generated/prisma/client"
import type { TaskPriority, TaskType } from "@/generated/prisma/enums"

import { createTask } from "../actions"
import { PRIORITY_META, PRIORITY_ORDER } from "./PriorityBadge"
import { TYPE_META } from "./TypeIcon"

type Member = Pick<User, "id" | "name" | "username" | "avatarKey">

const TYPE_ORDER = ["TASK", "BUG", "STORY"] as const
const TYPE_ITEMS: Record<string, string> = Object.fromEntries(
  TYPE_ORDER.map((t) => [t, TYPE_META[t].label]),
)
const PRIORITY_ITEMS: Record<string, string> = Object.fromEntries(
  PRIORITY_ORDER.map((p) => [p, PRIORITY_META[p].label]),
)
const UNASSIGNED = "UNASSIGNED"

// Only the plain-input fields go through react-hook-form. Type/priority/
// assignee are Select-driven — kept as ordinary useState (not RHF `watch()`)
// to match the established pattern (see admin/components/CreateUserDialog.tsx's
// `role` state): `watch()` returns a function React Compiler can't safely
// memoize, so components using it lose compiler optimisation.
const formSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  dueDate: z.string(),
})

type FormValues = z.infer<typeof formSchema>

export interface CreateTaskDialogProps {
  projectId: string
  members: Member[]
  labels: ProjectLabel[]
}

/**
 * "New task" dialog for the backlog toolbar. Title/type/priority/assignee/due
 * date go through react-hook-form + Zod; description (RichTextEditor) and the
 * label multi-pick are plain controlled state since neither maps cleanly onto
 * a native form input. Submits `createTask`; on success, toast + close +
 * `router.refresh()` so the backlog / board reflect the new row immediately.
 */
export function CreateTaskDialog({
  projectId,
  members,
  labels,
}: CreateTaskDialogProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()
  const [description, setDescription] = React.useState("")
  const [labelIds, setLabelIds] = React.useState<string[]>([])
  const [type, setType] = React.useState<TaskType>("TASK")
  const [priority, setPriority] = React.useState<TaskPriority>("MEDIUM")
  const [assigneeId, setAssigneeId] = React.useState(UNASSIGNED)
  const [formError, setFormError] = React.useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: "", dueDate: "" },
  })

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setTimeout(() => {
        reset()
        setDescription("")
        setLabelIds([])
        setType("TASK")
        setPriority("MEDIUM")
        setAssigneeId(UNASSIGNED)
        setFormError(null)
      }, 150)
    }
  }

  function toggleLabel(id: string) {
    setLabelIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const onSubmit = (values: FormValues) => {
    setFormError(null)
    startTransition(async () => {
      const res = await createTask({
        projectId,
        title: values.title,
        description: description || undefined,
        type,
        priority,
        assigneeId: assigneeId === UNASSIGNED ? null : assigneeId,
        dueDate: values.dueDate ? new Date(values.dueDate) : null,
        labelIds,
      })
      if (res.ok) {
        toast.success("Task created")
        onOpenChange(false)
        router.refresh()
      } else {
        setFormError(res.error)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus />
        New task
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>
            Add a task to this project&apos;s backlog.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="flex flex-col gap-4"
        >
          <FieldGroup>
            <Field data-invalid={!!errors.title || undefined}>
              <FieldLabel htmlFor="ct-title">Title</FieldLabel>
              <FieldContent>
                <Input
                  id="ct-title"
                  autoComplete="off"
                  aria-invalid={!!errors.title}
                  disabled={isPending}
                  {...register("title")}
                />
                <FieldError errors={[errors.title]} />
              </FieldContent>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="ct-type">Type</FieldLabel>
                <FieldContent>
                  <Select
                    value={type}
                    items={TYPE_ITEMS}
                    disabled={isPending}
                    onValueChange={(v) => v && setType(v as TaskType)}
                  >
                    <SelectTrigger id="ct-type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TYPE_ORDER.map((t) => (
                        <SelectItem key={t} value={t}>
                          {TYPE_META[t].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldContent>
              </Field>

              <Field>
                <FieldLabel htmlFor="ct-priority">Priority</FieldLabel>
                <FieldContent>
                  <Select
                    value={priority}
                    items={PRIORITY_ITEMS}
                    disabled={isPending}
                    onValueChange={(v) => v && setPriority(v as TaskPriority)}
                  >
                    <SelectTrigger id="ct-priority" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITY_ORDER.map((p) => (
                        <SelectItem key={p} value={p}>
                          {PRIORITY_META[p].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldContent>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="ct-assignee">Assignee</FieldLabel>
                <FieldContent>
                  <Select
                    value={assigneeId}
                    disabled={isPending}
                    onValueChange={(v) => v && setAssigneeId(v)}
                  >
                    <SelectTrigger id="ct-assignee" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                      {members.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldContent>
              </Field>

              <Field>
                <FieldLabel htmlFor="ct-due">Due date</FieldLabel>
                <FieldContent>
                  <Input
                    id="ct-due"
                    type="date"
                    disabled={isPending}
                    {...register("dueDate")}
                  />
                </FieldContent>
              </Field>
            </div>

            {labels.length > 0 ? (
              <Field>
                <FieldLabel>Labels</FieldLabel>
                <FieldContent>
                  <div className="flex max-h-32 flex-col gap-1.5 overflow-y-auto rounded-lg border border-border p-2">
                    {labels.map((label) => (
                      <label
                        key={label.id}
                        className="flex items-center gap-2 text-sm text-foreground"
                      >
                        <Checkbox
                          checked={labelIds.includes(label.id)}
                          onCheckedChange={() => toggleLabel(label.id)}
                          disabled={isPending}
                        />
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: label.color }}
                          aria-hidden
                        />
                        <span className="truncate">{label.name}</span>
                      </label>
                    ))}
                  </div>
                </FieldContent>
              </Field>
            ) : null}

            <Field>
              <FieldLabel>Description</FieldLabel>
              <FieldContent>
                <RichTextEditor
                  value={description}
                  onChange={setDescription}
                  minHeight="100px"
                  placeholder="Add more detail…"
                  editable={!isPending}
                />
              </FieldContent>
            </Field>
          </FieldGroup>

          {formError ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {formError}
            </p>
          ) : null}

          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating…" : "Create task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
