"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangleIcon } from "lucide-react";

interface NavigationWarningDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
}

export function NavigationWarningDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
}: NavigationWarningDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px] bg-card border-border shadow-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center text-2xl text-destructive">
            <AlertTriangleIcon className="mr-2 h-6 w-6" />
            {title}
          </DialogTitle>
          <DialogDescription>
            {description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button 
            onClick={onConfirm}
            variant="destructive"
            className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
          >
            <AlertTriangleIcon className="mr-2 h-4 w-4" /> Continue Anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 