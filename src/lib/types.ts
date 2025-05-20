import type { z } from 'zod';
import type { raceConfigSchema, driverSchema } from '@/lib/validators';

export interface Driver {
  id: string;
  name: string;
}

export interface StintEntry {
  driverId: string;
  plannedDurationMinutes?: number;
}

export interface RaceConfiguration extends Omit<z.infer<typeof raceConfigSchema>, 'stintSequence' | 'raceOfficialStartTime' | 'practiceDurationMinutes'> {
  stintSequence: StintEntry[];
  raceOfficialStartTime?: string; // ISO string from datetime-local, optional
  practiceDurationMinutes?: number; // Optional practice session duration
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
  raceStartTime: number | null; // timestamp
  pauseTime: number | null; // timestamp when paused
  accumulatedPauseDuration: number; // ms
  
  currentStintIndex: number;
  currentDriverId: string | null;
  
  stintStartTime: number | null; // timestamp for current driver's stint
  
  fuelTankStartTime: number | null; // timestamp when current fuel tank started
  fuelAlertActive: boolean;
  fuelWarning: boolean;
  fuelWarningTimeRemaining: number;

  raceFinishTime: number | null; // timestamp when race should end based on start and duration
  raceCompleted: boolean;
  completedStints: CompletedStintEntry[];

  // Practice Session State
  isPracticeActive: boolean;
  practiceStartTime: number | null;
  practiceFinishTime: number | null;
  practiceCompleted: boolean;
  isPracticePaused: boolean;
  practicePauseTime: number | null;
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
};

export const initialRaceState: Omit<CurrentRaceState, 'config'> = {
  isRaceActive: false,
  isRacePaused: false,
  raceStartTime: null,
  pauseTime: null,
  accumulatedPauseDuration: 0,
  currentStintIndex: 0,
  currentDriverId: null,
  stintStartTime: null,
  fuelTankStartTime: null,
  fuelAlertActive: false,
  fuelWarning: false,
  fuelWarningTimeRemaining: 0,
  raceFinishTime: null,
  raceCompleted: false,
  completedStints: [],
  // Practice initial state
  isPracticeActive: false,
  practiceStartTime: null,
  practiceFinishTime: null,
  practiceCompleted: false,
  isPracticePaused: false,
  practicePauseTime: null,
};

