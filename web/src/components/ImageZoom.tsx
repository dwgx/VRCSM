import { useState } from "react";
import { Copy, Download, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface ImageZoomProps {
  src: string;
  alt?: string;
  className?: string;
  imgClassName?: string;
  children?: React.ReactNode;
}

export function ImageZoom({ src, alt, className, imgClassName, children }: ImageZoomProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={cn("cursor-zoom-in", className)}
      >
        {children ?? (
          <img
            src={src}
            alt={alt ?? ""}
            loading="lazy"
            decoding="async"
            className={cn("rounded", imgClassName)}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[90vw] w-fit p-0 gap-0 overflow-hidden border-[hsl(var(--border-strong))]">
          <DialogTitle className="sr-only">{alt || "Image preview"}</DialogTitle>
          <DialogDescription className="sr-only">Full size image preview</DialogDescription>

          {/* Image */}
          <div className="relative flex items-center justify-center bg-black/40 min-h-[200px]">
            <img
              src={src}
              alt={alt ?? ""}
              className="max-h-[75vh] max-w-[88vw] object-contain"
            />
          </div>

          {/* Bottom bar */}
          <div className="flex items-center justify-between gap-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2">
            <span className="truncate text-[11px] text-[hsl(var(--muted-foreground))] font-mono max-w-[50%]">
              {alt || ""}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(src);
                  toast.success("URL copied");
                }}
                className="rounded-[var(--radius-sm)] p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))] transition-colors"
                title="Copy URL"
              >
                <Copy className="size-3.5" />
              </button>
              <a
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                download
                className="rounded-[var(--radius-sm)] p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))] transition-colors"
                title="Download"
              >
                <Download className="size-3.5" />
              </a>
              <a
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-[var(--radius-sm)] p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))] transition-colors"
                title="Open in browser"
              >
                <ExternalLink className="size-3.5" />
              </a>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
