"use client";

import { cn } from "@/lib/utils";

interface TimerDisplayProps {
  timeMs: number;
  label: string;
  className?: string;
  variant?: "default" | "warning" | "critical";
  isLoading?: boolean;
  showMilliseconds?: boolean;
}

export function formatTime(ms: number, showMilliseconds = false): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = Math.floor((ms % 1000) / 10); // Show two digits for ms

  let timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  if (showMilliseconds) {
    timeString += `.${milliseconds.toString().padStart(2, '0')}`;
  }
  return timeString;
}


export function TimerDisplay({ timeMs, label, className, variant = "default", isLoading = false, showMilliseconds = false }: TimerDisplayProps) {
  const timeString = isLoading ? (showMilliseconds ? "00:00:00.00" : "00:00:00") : formatTime(timeMs, showMilliseconds);

  const variantClasses = {
    default: "text-foreground",
    warning: "text-yellow-500", // Brighter yellow for warning
    critical: "text-destructive", // Red for critical
  };

  return (
    <div className={cn("text-center p-4 rounded-lg shadow-md bg-card border", className)}>
      <div className="text-sm font-medium text-muted-foreground mb-1">{label}</div>
      <div className={cn(
        "text-4xl font-mono font-bold tracking-wider",
        variantClasses[variant],
        isLoading && "opacity-50"
       )}>
        {timeString}
      </div>
    </div>
  );
}
