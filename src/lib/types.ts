
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

// Add raceOfficialStartTime to RaceConfiguration
export interface RaceConfigurationNoStartTime extends Omit<z.infer<typeof raceConfigSchema>, 'stintSequence'> {
  stintSequence: StintEntry[];
}

export interface RaceConfiguration extends RaceConfigurationNoStartTime {
  raceOfficialStartTime?: string; // ISO string from datetime-local, optional
}

export type DriverSchema = z.infer<typeof driverSchema>;

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

  raceFinishTime: number | null; // timestamp when race should end based on start and duration
  raceCompleted: boolean;
}

export const DEFAULT_RACE_CONFIG: RaceConfiguration = {
  drivers: [{ id: 'driver1', name: 'Driver 1' }],
  stintSequence: [{ driverId: 'driver1' }], // plannedDurationMinutes is implicitly undefined
  fuelDurationMinutes: 60,
  raceDurationMinutes: 120,
  raceOfficialStartTime: undefined,
};

