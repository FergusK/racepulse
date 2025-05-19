
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
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Driver, RaceConfiguration } from "@/lib/types";
import { useState, useEffect } from "react";
import { Users, RotateCcw, TimerIcon } from "lucide-react";

interface DriverSwapDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (nextDriverId: string, refuel: boolean, nextStintPlannedDuration?: number) => void;
  currentDriverId: string | null;
  config: RaceConfiguration;
  nextPlannedDriverId?: string | null;
  nextStintOriginalPlannedDurationMinutes?: number;
}

export function DriverSwapDialog({
  isOpen,
  onClose,
  onConfirm,
  currentDriverId,
  config,
  nextPlannedDriverId,
  nextStintOriginalPlannedDurationMinutes,
}: DriverSwapDialogProps) {
  const [selectedDriverId, setSelectedDriverId] = useState<string>("");
  const [refuel, setRefuel] = useState<boolean>(true);
  const [nextStintDuration, setNextStintDuration] = useState<string>("");

  useEffect(() => {
    if (isOpen) {
      const availableDrivers = config.drivers.filter(d => d.id !== currentDriverId);
      if (nextPlannedDriverId && config.drivers.some(d => d.id === nextPlannedDriverId) && nextPlannedDriverId !== currentDriverId) {
        setSelectedDriverId(nextPlannedDriverId);
      } else if (availableDrivers.length > 0) {
        setSelectedDriverId(availableDrivers[0].id);
      } else if (config.drivers.length > 0) {
        setSelectedDriverId(config.drivers[0].id)
      }
      setRefuel(true);
      setNextStintDuration(nextStintOriginalPlannedDurationMinutes?.toString() || "");
    }
  }, [isOpen, config.drivers, currentDriverId, nextPlannedDriverId, nextStintOriginalPlannedDurationMinutes]);

  const handleConfirm = () => {
    if (selectedDriverId) {
      const duration = nextStintDuration.trim() === "" ? undefined : parseInt(nextStintDuration, 10);
      onConfirm(selectedDriverId, refuel, isNaN(duration!) ? undefined : duration);
      onClose();
    }
  };

  const availableDrivers = config.drivers.filter(d => d.id !== currentDriverId);
  const displayDrivers = availableDrivers.length > 0 ? availableDrivers : config.drivers; 

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px] bg-card border-border shadow-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center text-2xl">
            <Users className="mr-2 h-6 w-6 text-primary" />
            Swap Driver
          </DialogTitle>
          <DialogDescription>
            Select the next driver, choose to refuel, and optionally adjust the next stint's planned duration.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="nextDriver" className="text-right col-span-1 text-muted-foreground">
              Next Driver
            </Label>
            <Select
              value={selectedDriverId}
              onValueChange={setSelectedDriverId}
              disabled={displayDrivers.length === 0}
            >
              <SelectTrigger id="nextDriver" className="col-span-3">
                <SelectValue placeholder="Select next driver" />
              </SelectTrigger>
              <SelectContent>
                {displayDrivers.map((driver: Driver) => (
                  <SelectItem key={driver.id} value={driver.id}>
                    {driver.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label 
              htmlFor="nextStintDuration" 
              className="text-right col-span-2 text-muted-foreground flex items-center justify-end pr-1"
            >
              <TimerIcon className="h-4 w-4 mr-1 inline-block flex-shrink-0" />
              <span className="whitespace-nowrap">Next Duration</span>
            </Label>
            <Input
              id="nextStintDuration"
              type="number"
              min="1"
              value={nextStintDuration}
              onChange={(e) => setNextStintDuration(e.target.value)}
              placeholder={`Default (${config.fuelDurationMinutes} min)`}
              className="col-span-2"
            />
          </div>
          <div className="flex items-center space-x-3 justify-center col-span-4">
            <Checkbox
              id="refuel"
              checked={refuel}
              onCheckedChange={(checked) => setRefuel(Boolean(checked))}
            />
            <Label htmlFor="refuel" className="text-base font-medium cursor-pointer">
              Refuel vehicle?
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={!selectedDriverId} className="bg-primary hover:bg-primary/90 text-primary-foreground">
            <RotateCcw className="mr-2 h-4 w-4" /> Confirm Swap
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
