// shadcn/ui Command (cmdk implementation). Colors use our semantic tokens.
import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex size-full flex-col overflow-hidden bg-bg text-fg",
        className,
      )}
      {...props}
    />
  );
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  showCloseButton = false,
  onEscapeKeyDown,
  style,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string;
  description?: string;
  className?: string;
  style?: React.CSSProperties;
  showCloseButton?: boolean;
  /** preventDefault() keeps the dialog open (a sub-page stepping back). */
  onEscapeKeyDown?: React.ComponentProps<
    typeof DialogContent
  >["onEscapeKeyDown"];
}) {
  return (
    <Dialog {...props}>
      <DialogContent
        className={cn(
          "max-h-[calc(100vh-2rem)] overflow-hidden p-0",
          className,
        )}
        showCloseButton={showCloseButton}
        onEscapeKeyDown={onEscapeKeyDown}
        style={style}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function CommandInput({
  className,
  badge,
  leading,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input> & {
  /** Shown before the field: where in the menu the input is searching. */
  badge?: React.ReactNode;
  /** In the field ahead of its text (the search's chips). */
  leading?: React.ReactNode;
}) {
  return (
    // A field of its own inside the menu, as VS Code's quick pick has: the
    // command menu lays it over the title bar's search (CommandMenu's
    // FIELD_INSET is this p-1 plus the menu's border).
    <div data-slot="command-input-wrapper" className="p-1">
      {/* py-[3px] around the h-6 field and the border make the h-8 of the
          title bar's search, which it lies over; chips wrap below. */}
      <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-ring bg-bg px-2 py-[3px]">
        <Search className="size-3.5 shrink-0 text-muted" />
        {leading}
        {badge != null && (
          <span
            data-slot="command-input-badge"
            className="max-w-[45%] shrink-0 truncate rounded-full bg-overlay px-2 py-0.5 text-xs text-fg"
          >
            {badge}
          </span>
        )}
        <CommandPrimitive.Input
          data-slot="command-input"
          className={cn(
            "flex h-6 min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          {...props}
        />
      </div>
    </div>
  );
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <ScrollArea className="h-[min(340px,calc(100vh-12rem))]">
      <CommandPrimitive.List
        data-slot="command-list"
        className={cn("overflow-x-hidden p-1.5", className)}
        {...props}
      />
    </ScrollArea>
  );
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn("py-8 text-center text-sm text-muted", className)}
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-1 text-fg [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted",
        className,
      )}
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none",
        "data-[disabled=true]:pointer-events-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn("ml-auto text-xs tracking-widest text-muted", className)}
      {...props}
    />
  );
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
};
