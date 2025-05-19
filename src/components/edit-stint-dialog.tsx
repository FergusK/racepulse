
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
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Driver } from "@/lib/types";
import { useState, useEffect } from "react";
import { Users, TimerIcon, Save } from "lucide-react";

interface EditStintDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (driverId: string, plannedDurationMinutes?: number) => void;
  availableDrivers: Driver[];
  initialDriverId?: string;
  initialDuration?: number;
  defaultDuration: number; // Global fuel duration as fallback for placeholder
  isAdding: boolean;
}

export function EditStintDialog({
  isOpen,
  onClose,
  onConfirm,
  availableDrivers,
  initialDriverId,
  initialDuration,
  defaultDuration,
  isAdding,
}: EditStintDialogProps) {
  const [selectedDriverId, setSelectedDriverId] = useState<string>("");
  const [stintDuration, setStintDuration] = useState<string>("");

  useEffect(() => {
    if (isOpen) {
      if (initialDriverId && availableDrivers.some(d => d.id === initialDriverId)) {
        setSelectedDriverId(initialDriverId);
      } else if (availableDrivers.length > 0) {
        setSelectedDriverId(availableDrivers[0].id);
      } else {
        setSelectedDriverId(""); // Should not happen if dialog is opened correctly
      }
      setStintDuration(initialDuration?.toString() || "");
    }
  }, [isOpen, initialDriverId, initialDuration, availableDrivers]);

  const handleConfirm = () => {
    if (selectedDriverId || availableDrivers.length === 0) { // Allow confirm if no drivers exist for some edge case
      const duration = stintDuration.trim() === "" ? undefined : parseInt(stintDuration, 10);
      onConfirm(selectedDriverId, isNaN(duration!) ? undefined : duration);
      onClose();
    }
  };

  const dialogTitle = isAdding ? "Add New Stint" : "Edit Stint Details";
  const dialogDescription = isAdding 
    ? "Select a driver and optionally set a planned duration for this new stint."
    : "Modify the driver and/or planned duration for this upcoming stint.";

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px] bg-card border-border shadow-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center text-2xl">
            <Users className="mr-2 h-6 w-6 text-primary" />
            {dialogTitle}
          </DialogTitle>
          <DialogDescription>
            {dialogDescription}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="grid gap-2">
            <Label htmlFor="stintDriver" className="text-muted-foreground">
              Driver
            </Label>
            <Select
              value={selectedDriverId}
              onValueChange={setSelectedDriverId}
              disabled={availableDrivers.length === 0}
            >
              <SelectTrigger id="stintDriver">
                <SelectValue placeholder="Select driver" />
              </SelectTrigger>
              <SelectContent>
                {availableDrivers.map((driver: Driver) => (
                  <SelectItem key={driver.id} value={driver.id}>
                    {driver.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableDrivers.length === 0 && <p className="text-xs text-destructive">No drivers available. Add drivers in Setup.</p>}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="stintPlannedDuration" className="text-muted-foreground flex items-center">
              <TimerIcon className="h-4 w-4 mr-2" />
              Planned Duration (mins)
            </Label>
            <Input
              id="stintPlannedDuration"
              type="number"
              min="1"
              value={stintDuration}
              onChange={(e) => setStintDuration(e.target.value)}
              placeholder={`Default (${defaultDuration} min)`}
            />
            <p className="text-xs text-muted-foreground">Leave blank to use default fuel duration.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button 
            onClick={handleConfirm} 
            disabled={availableDrivers.length > 0 && !selectedDriverId} 
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Save className="mr-2 h-4 w-4" /> {isAdding ? "Add Stint" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
