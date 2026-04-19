import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const AlertDialog = Dialog;

function AlertDialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      className={cn("max-w-md gap-4", className)}
      onPointerDownOutside={(e) => e.preventDefault()}
      {...props}
    >
      {children}
    </DialogContent>
  );
}

function AlertDialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

function AlertDialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex justify-end gap-2", className)} {...props} />;
}

const AlertDialogTitle = DialogTitle;
const AlertDialogDescription = DialogDescription;

function AlertDialogAction({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return <Button className={cn(className)} {...props} />;
}

function AlertDialogCancel({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return <Button variant="outline" className={cn(className)} {...props} />;
}

export {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
