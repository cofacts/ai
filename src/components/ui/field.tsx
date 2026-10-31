import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/**
 * Penpot Base/Input, Type = Field-*: a title above the control. Pair `FieldLabel htmlFor` with the
 * control's `id`.
 */
function Field({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      role="group"
      data-slot="field"
      className={cn('flex w-full flex-col gap-spacing-4', className)}
      {...props}
    />
  )
}

function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="field-label"
      className={cn('w-fit', className)}
      {...props}
    />
  )
}

/**
 * The error text for an invalid control (a11y guide: red border, `aria-invalid` and a message).
 * Give it an `id` and point the control's `aria-describedby` at it.
 */
function FieldError({ className, ...props }: React.ComponentProps<'div'>) {
  if (!props.children) return null
  return (
    <div
      role="alert"
      data-slot="field-error"
      className={cn('text-type-body-s text-status-incorrect', className)}
      {...props}
    />
  )
}

/** A named group of controls, e.g. a RadioGroup: `<fieldset>` named by its `FieldLegend`. */
function FieldSet({ className, ...props }: React.ComponentProps<'fieldset'>) {
  return (
    <fieldset
      data-slot="field-set"
      className={cn(
        'flex flex-col gap-spacing-24 has-[>[data-slot=radio-group]]:gap-spacing-12',
        className,
      )}
      {...props}
    />
  )
}

function FieldLegend({
  className,
  variant = 'legend',
  ...props
}: React.ComponentProps<'legend'> & { variant?: 'legend' | 'label' }) {
  return (
    <legend
      data-slot="field-legend"
      data-variant={variant}
      className={cn(
        'mb-spacing-12 data-[variant=label]:text-type-ui-m data-[variant=legend]:text-type-heading-xs',
        className,
      )}
      {...props}
    />
  )
}

export { Field, FieldLabel, FieldError, FieldSet, FieldLegend }
