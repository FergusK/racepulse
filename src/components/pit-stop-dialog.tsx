"use client";

import { useState, useEffect, useRef } from "react";
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

interface PitStopDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (fuelTime: number) => void;
  currentTime: number;
}

export function PitStopDialog({
  isOpen,
  onClose,
  onConfirm,
  currentTime,
}: PitStopDialogProps) {
  const [hours, setHours] = useState<string>("");
  const [minutes, setMinutes] = useState<string>("");
  const initialized = useRef(false);

  useEffect(() => {
    if (isOpen && !initialized.current) {
      const date = new Date(currentTime);
      setHours(date.getHours().toString().padStart(2, '0'));
      setMinutes(date.getMinutes().toString().padStart(2, '0'));
      initialized.current = true;
    } else if (!isOpen) {
      initialized.current = false;
    }
  }, [isOpen, currentTime]);

  const handleConfirm = () => {
    if (hours && minutes) {
      const date = new Date(currentTime);
      date.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
      onConfirm(date.getTime());
      onClose();
    }
  };

  const handleHoursChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || (parseInt(value) >= 0 && parseInt(value) <= 23)) {
      setHours(value);
    }
  };

  const handleMinutesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || (parseInt(value) >= 0 && parseInt(value) <= 59)) {
      setMinutes(value);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px] bg-card border-border shadow-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center text-2xl">
            <TimerIcon className="mr-2 h-6 w-6 text-primary" />
            Pit Stop
          </DialogTitle>
          <DialogDescription>
            Record the time when the pit stop occurred.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="grid gap-2">
            <Label className="text-muted-foreground flex items-center">
              <TimerIcon className="h-4 w-4 mr-2" />
              Pit Stop Time (HH:MM)
            </Label>
            <div className="flex items-center gap-2">
              <Input
                type="text"
                value={hours}
                onChange={handleHoursChange}
                placeholder="HH"
                className="w-20 text-center"
                maxLength={2}
              />
              <span className="text-lg">:</span>
              <Input
                type="text"
                value={minutes}
                onChange={handleMinutesChange}
                placeholder="MM"
                className="w-20 text-center"
                maxLength={2}
              />
            </div>
            <p className="text-xs text-muted-foreground">Enter the time when the pit stop occurred (24-hour format).</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button 
            onClick={handleConfirm} 
            disabled={!hours || !minutes || parseInt(hours) > 23 || parseInt(minutes) > 59} 
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <TimerIcon className="mr-2 h-4 w-4" /> Confirm Pit Stop
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 