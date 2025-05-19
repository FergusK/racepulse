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
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Driver, RaceConfiguration } from "@/lib/types";
import { useState, useEffect } from "react";
import { Users, RotateCcw } from "lucide-react";

interface DriverSwapDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (nextDriverId: string, refuel: boolean) => void;
  currentDriverId: string | null;
  config: RaceConfiguration;
  nextPlannedDriverId?: string | null;
}

export function DriverSwapDialog({
  isOpen,
  onClose,
  onConfirm,
  currentDriverId,
  config,
  nextPlannedDriverId,
}: DriverSwapDialogProps) {
  const [selectedDriverId, setSelectedDriverId] = useState<string>("");
  const [refuel, setRefuel] = useState<boolean>(true);

  useEffect(() => {
    if (isOpen) {
      // Try to pre-select the next planned driver, or the first available different driver
      const availableDrivers = config.drivers.filter(d => d.id !== currentDriverId);
      if (nextPlannedDriverId && config.drivers.some(d => d.id === nextPlannedDriverId) && nextPlannedDriverId !== currentDriverId) {
        setSelectedDriverId(nextPlannedDriverId);
      } else if (availableDrivers.length > 0) {
        setSelectedDriverId(availableDrivers[0].id);
      } else if (config.drivers.length > 0) {
        setSelectedDriverId(config.drivers[0].id) // Fallback if only one driver
      }
      setRefuel(true); // Default to refuel
    }
  }, [isOpen, config.drivers, currentDriverId, nextPlannedDriverId]);

  const handleConfirm = () => {
    if (selectedDriverId) {
      onConfirm(selectedDriverId, refuel);
      onClose();
    }
  };

  const availableDrivers = config.drivers.filter(d => d.id !== currentDriverId);
  const displayDrivers = availableDrivers.length > 0 ? availableDrivers : config.drivers; // Show all if current is the only one or not set

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px] bg-card border-border shadow-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center text-2xl">
            <Users className="mr-2 h-6 w-6 text-primary" />
            Swap Driver
          </DialogTitle>
          <DialogDescription>
            Select the next driver and choose to refuel.
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
