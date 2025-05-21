import type { z } from 'zod';
import type { raceConfigSchema, driverSchema } from '@/lib/validators';

export interface Driver {
  id: string;
  name: string;
}

export interface StintEntry {
  driverId: string;
  plannedDurationMinutes?: number;
  checkupMinutes?: number; // Optional checkup time override for this stint
}

export interface RaceConfiguration extends Omit<z.infer<typeof raceConfigSchema>, 'stintSequence' | 'raceOfficialStartTime' | 'practiceDurationMinutes'> {
  stintSequence: StintEntry[];
  raceOfficialStartTime?: string; // ISO string from datetime-local, optional
  practiceDurationMinutes?: number; // Optional practice session duration
  driverCheckupMinutes?: number; // Default checkup time for all drivers
}

export type DriverSchema = z.infer<typeof driverSchema>;

export interface CompletedStintEntry {
  driverId: string;
  driverName: string;
  stintNumber: number; // 1-based index of the stint in the original sequence
  startTime: number; // timestamp
  endTime: number; // timestamp
  actualDurationMs: number;
  plannedDurationMinutes?: number; // Original planned duration for this stint
  refuelled: boolean; // Indicates if a refuel happened at the end of this stint
}

export interface CurrentRaceState {
  config: RaceConfiguration | null;
  isRaceActive: boolean;
  isRacePaused: boolean;
  isPracticeActive: boolean;
  isPracticePaused: boolean;
  raceStartTime: number | null;
  practiceStartTime: number | null;
  practiceFinishTime: number | null;
  pauseTime: number | null;
  practicePauseTime: number | null;
  accumulatedPauseDuration: number;
  currentStintIndex: number;
  currentDriverId: string | null;
  stintStartTime: number | null;
  fuelTankStartTime: number | null;
  fuelAlertActive: boolean;
  raceFinishTime: number | null;
  raceCompleted: boolean;
  practiceCompleted: boolean;
  completedStints: CompletedStintEntry[];
  lastCheckupTime: number | null;
  raceStatus: 'setup' | 'running' | 'paused' | 'completed';
  elapsedMinutes: number;
  stintSequence: StintEntry[];
  fuelWarning: boolean;
  fuelWarningTimeRemaining: number | null;
}

export interface Race {
  id: string;
  name: string;
  date: string;
  location: string;
  config: RaceConfiguration;
}

export const DEFAULT_RACE_CONFIG: RaceConfiguration = {
  drivers: [{ id: 'driver1', name: 'Driver 1' }],
  stintSequence: [{ driverId: 'driver1' }], 
  fuelDurationMinutes: 60,
  fuelWarningThresholdMinutes: 5,
  raceDurationMinutes: 120,
  raceOfficialStartTime: undefined,
  practiceDurationMinutes: undefined,
  driverCheckupMinutes: 30, // Default 30 minutes between driver checkups
};

export const INITIAL_RACE_STATE: Omit<CurrentRaceState, "config"> = {
  isRaceActive: false,
  isRacePaused: false,
  isPracticeActive: false,
  isPracticePaused: false,
  raceStartTime: null,
  practiceStartTime: null,
  practiceFinishTime: null,
  pauseTime: null,
  practicePauseTime: null,
  accumulatedPauseDuration: 0,
  currentStintIndex: 0,
  currentDriverId: null,
  stintStartTime: null,
  fuelTankStartTime: null,
  fuelAlertActive: false,
  raceFinishTime: null,
  raceCompleted: false,
  practiceCompleted: false,
  completedStints: [],
  lastCheckupTime: null,
  raceStatus: 'setup',
  elapsedMinutes: 0,
  stintSequence: [],
  fuelWarning: false,
  fuelWarningTimeRemaining: null,
};

