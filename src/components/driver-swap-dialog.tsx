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
  onConfirm: (nextDriverId: string, refuel: boolean, nextStintPlannedDuration?: number, fuelTime?: number) => void;
  currentDriverId: string | null;
  config: RaceConfiguration;
  nextPlannedDriverId?: string | null;
  nextStintOriginalPlannedDurationMinutes?: number;
  currentRaceTime?: number;
}

export function DriverSwapDialog({
  isOpen,
  onClose,
  onConfirm,
  currentDriverId,
  config,
  nextPlannedDriverId,
  nextStintOriginalPlannedDurationMinutes,
  currentRaceTime = 0,
}: DriverSwapDialogProps) {
  const [selectedDriverId, setSelectedDriverId] = useState<string>("");
  const [refuel, setRefuel] = useState<boolean>(true);
  const [nextStintDuration, setNextStintDuration] = useState<string>("");
  const [fuelTime, setFuelTime] = useState<string>("");

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
      setFuelTime("");
    }
  }, [isOpen, config.drivers, currentDriverId, nextPlannedDriverId, nextStintOriginalPlannedDurationMinutes]);

  const handleConfirm = () => {
    if (selectedDriverId) {
      const duration = nextStintDuration.trim() === "" ? undefined : parseInt(nextStintDuration, 10);
      const fuelTimeMs = refuel && fuelTime ? parseTimeToMs(fuelTime) : undefined;
      onConfirm(selectedDriverId, refuel, isNaN(duration!) ? undefined : duration, fuelTimeMs);
      onClose();
    }
  };

  const formatTime = (ms: number): string => {
    const date = new Date(ms);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const parseTimeToMs = (timeStr: string): number => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date.getTime();
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
        <div className="space-y-6 py-4">
          <div className="grid gap-2">
            <Label htmlFor="nextDriver" className="text-muted-foreground">
              Next Driver
            </Label>
            <Select
              value={selectedDriverId}
              onValueChange={setSelectedDriverId}
              disabled={displayDrivers.length === 0}
            >
              <SelectTrigger id="nextDriver">
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

          <div className="grid gap-2">
            <Label htmlFor="nextStintDuration" className="text-muted-foreground flex items-center">
              <TimerIcon className="h-4 w-4 mr-2" />
              Next Stint Planned Duration (mins)
            </Label>
            <Input
              id="nextStintDuration"
              type="number"
              min="1"
              value={nextStintDuration}
              onChange={(e) => setNextStintDuration(e.target.value)}
              placeholder={`Default (${nextStintOriginalPlannedDurationMinutes || config.fuelDurationMinutes} min)`}
            />
          </div>

          <div className="flex items-center space-x-3 justify-center pt-2">
            <Checkbox
              id="refuel"
              checked={refuel}
              onCheckedChange={(checked) => setRefuel(Boolean(checked))}
            />
            <Label htmlFor="refuel" className="text-base font-medium cursor-pointer">
              Refuel vehicle?
            </Label>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="fuelTime" className="text-muted-foreground flex items-center">
              <TimerIcon className="h-4 w-4 mr-2" />
              Swap Time (HH:MM)
            </Label>
            <Input
              id="fuelTime"
              type="time"
              value={fuelTime}
              onChange={(e) => setFuelTime(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Optional: Enter the time when the driver swap occurred (24-hour format). If left empty, current time will be used.</p>
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
