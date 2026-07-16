"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { FolderPlus } from "lucide-react"
import { toast } from "sonner"
import type { z } from "zod"

import { Button } from "@/components/ui/button"
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
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

import { createProject } from "@/features/projects/actions"
import { createProjectSchema } from "@/features/projects/schemas"

// Admin creates the lead server-side (defaults to the creating admin) — the
// dialog only collects what the admin actually decides here.
const formSchema = createProjectSchema.omit({ leadId: true })
type FormValues = z.infer<typeof formSchema>

/**
 * Admin-only "New project" dialog. Reuses `createProjectSchema` (minus
 * `leadId`) so client-side validation never drifts from what the Server
 * Action enforces. On success, hands off straight to the new project.
 */
export function CreateProjectDialog() {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()
  const [formError, setFormError] = React.useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { key: "", name: "", description: "" },
  })

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setTimeout(() => {
        reset()
        setFormError(null)
      }, 150)
    }
  }

  const onSubmit = (values: FormValues) => {
    setFormError(null)
    startTransition(async () => {
      const res = await createProject({
        key: values.key,
        name: values.name,
        description: values.description || undefined,
      })
      if (res.ok && res.data) {
        toast.success("Project created")
        onOpenChange(false)
        router.push(`/projects/${res.data.id}`)
      } else if (!res.ok) {
        setFormError(res.error)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button size="sm" />}>
        <FolderPlus />
        New project
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Creates the project and adds you as its manager.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="flex flex-col gap-4"
        >
          <FieldGroup>
            <Field data-invalid={!!errors.key || undefined}>
              <FieldLabel htmlFor="cp-key">Key</FieldLabel>
              <FieldContent>
                <Input
                  id="cp-key"
                  autoComplete="off"
                  aria-invalid={!!errors.key}
                  disabled={isPending}
                  className="font-mono uppercase"
                  {...register("key", {
                    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                      event.target.value = event.target.value.toUpperCase()
                    },
                  })}
                />
                <FieldDescription>
                  2–6 letters/digits, starts with a letter — backs task keys
                  like {"KEY"}-42.
                </FieldDescription>
                <FieldError errors={[errors.key]} />
              </FieldContent>
            </Field>

            <Field data-invalid={!!errors.name || undefined}>
              <FieldLabel htmlFor="cp-name">Name</FieldLabel>
              <FieldContent>
                <Input
                  id="cp-name"
                  autoComplete="off"
                  aria-invalid={!!errors.name}
                  disabled={isPending}
                  {...register("name")}
                />
                <FieldError errors={[errors.name]} />
              </FieldContent>
            </Field>

            <Field data-invalid={!!errors.description || undefined}>
              <FieldLabel htmlFor="cp-description">Description</FieldLabel>
              <FieldContent>
                <Textarea
                  id="cp-description"
                  rows={3}
                  disabled={isPending}
                  {...register("description")}
                />
                <FieldError errors={[errors.description]} />
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
              {isPending ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
