"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { TimerIcon } from "lucide-react";

interface EditStintTimeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (startTime: number) => void;
  currentStartTime: number;
}

export function EditStintTimeDialog({
  isOpen,
  onClose,
  onConfirm,
  currentStartTime,
}: EditStintTimeDialogProps) {
  const [startTime, setStartTime] = useState<string>("");

  useEffect(() => {
    if (isOpen) {
      const date = new Date(currentStartTime);
      setStartTime(date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }
  }, [isOpen, currentStartTime]);

  const handleConfirm = () => {
    if (startTime) {
      const [hours, minutes] = startTime.split(':').map(Number);
      const date = new Date();
      date.setHours(hours, minutes, 0, 0);
      onConfirm(date.getTime());
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px] bg-card border-border shadow-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center text-2xl">
            <TimerIcon className="mr-2 h-6 w-6 text-primary" />
            Edit Stint Start Time
          </DialogTitle>
          <DialogDescription>
            Update the start time for the current stint.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="grid gap-2">
            <Label htmlFor="startTime" className="text-muted-foreground flex items-center">
              <TimerIcon className="h-4 w-4 mr-2" />
              Start Time (HH:MM)
            </Label>
            <Input
              id="startTime"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Enter the time when the stint started (24-hour format).</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={!startTime} className="bg-primary hover:bg-primary/90 text-primary-foreground">
            <TimerIcon className="mr-2 h-4 w-4" /> Update Time
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 