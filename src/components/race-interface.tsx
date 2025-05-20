
"use client";

import type { RaceConfiguration, CurrentRaceState, Driver, StintEntry, CompletedStintEntry } from '@/lib/types';
import { initialRaceState, DEFAULT_RACE_CONFIG } from '@/lib/types';
import { useState, useEffect, useCallback, useReducer, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { RACE_CONFIG_LOCAL_STORAGE_KEY, LOW_FUEL_THRESHOLD_MINUTES, RACE_STATE_LOCAL_STORAGE_KEY_FULL } from '@/lib/config';
import { TimerDisplay, formatTime } from '@/components/timer-display';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription as UICardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { DriverSwapDialog } from '@/components/driver-swap-dialog';
import { EditStintDialog } from '@/components/edit-stint-dialog';
import { Progress } from "@/components/ui/progress";
import { Play, Pause, RotateCcw, Users, Fuel, Flag, AlertTriangle, TimerIcon, History, Clock, Pencil, PlusCircle, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from '@/lib/utils';


type RaceAction =
  | { type: 'START_RACE' }
  | { type: 'PAUSE_RACE' }
  | { type: 'RESUME_RACE' }
  | { type: 'RESET_RACE_LOGIC' }
  | { type: 'SWAP_DRIVER'; payload: { nextDriverId: string; refuel: boolean; nextStintPlannedDuration?: number } }
  | { type: 'TICK'; payload: { currentTime: number } }
  | { type: 'LOAD_CONFIG'; payload: RaceConfiguration }
  | { type: 'SET_FULL_STATE'; payload: CurrentRaceState }
  | { type: 'UPDATE_STINT_IN_SEQUENCE'; payload: { stintIndex: number; driverId: string; plannedDurationMinutes?: number } }
  | { type: 'ADD_STINT_TO_SEQUENCE'; payload: { driverId: string; plannedDurationMinutes?: number } }
  | { type: 'DELETE_STINT_FROM_SEQUENCE'; payload: { stintIndex: number } };


function raceReducer(state: CurrentRaceState, action: RaceAction): CurrentRaceState {
  let config = state.config;
  const currentTime = action.type === 'TICK' ? action.payload.currentTime : Date.now();

  switch (action.type) {
    case 'SET_FULL_STATE': {
      let loadedState = action.payload;
      if (loadedState.isRacePaused && loadedState.pauseTime) {
        const offlinePauseDuration = Math.max(0, currentTime - loadedState.pauseTime);
        loadedState = {
          ...loadedState,
          accumulatedPauseDuration: loadedState.accumulatedPauseDuration + offlinePauseDuration,
          pauseTime: currentTime,
          raceFinishTime: loadedState.raceFinishTime ? loadedState.raceFinishTime + offlinePauseDuration : null,
        };
      }
      if (loadedState.config && loadedState.fuelTankStartTime && loadedState.isRaceActive && !loadedState.isRacePaused) {
        const fuelElapsedTimeMs = currentTime - loadedState.fuelTankStartTime;
        const fuelDurationMs = loadedState.config.fuelDurationMinutes * 60 * 1000;
        const fuelRemainingMs = Math.max(0, fuelDurationMs - fuelElapsedTimeMs);
        loadedState = {
          ...loadedState,
          fuelAlertActive: fuelRemainingMs < LOW_FUEL_THRESHOLD_MINUTES * 60 * 1000,
        };
      }
      return loadedState;
    }
    case 'LOAD_CONFIG': {
      const newConfig = action.payload;
      let newRaceFinishTime = state.raceFinishTime;

      // Adjust raceFinishTime if raceDurationMinutes changed in the new config and race has started
      if (state.raceStartTime && newConfig && state.config && newConfig.raceDurationMinutes !== state.config.raceDurationMinutes) {
        const durationDeltaMs = (newConfig.raceDurationMinutes - state.config.raceDurationMinutes) * 60 * 1000;
        if (state.raceFinishTime) {
          newRaceFinishTime = state.raceFinishTime + durationDeltaMs;
        } else { // Should not happen if raceStartTime is set, but as a fallback
            const referenceStartTimeForDuration = newConfig.raceOfficialStartTime && Date.parse(newConfig.raceOfficialStartTime) <= state.raceStartTime
                                                ? Date.parse(newConfig.raceOfficialStartTime)
                                                : state.raceStartTime;
            newRaceFinishTime = referenceStartTimeForDuration + newConfig.raceDurationMinutes * 60 * 1000 + state.accumulatedPauseDuration;
        }
      }
      
      let resolvedCurrentDriverId = state.currentDriverId;
      let resolvedCurrentStintIndex = state.currentStintIndex;

      if (!state.isRaceActive && newConfig.stintSequence.length > 0) {
        resolvedCurrentStintIndex = 0;
        resolvedCurrentDriverId = newConfig.stintSequence[0].driverId;
      } else if (state.isRaceActive && newConfig.stintSequence.length > 0) {
        if (state.currentStintIndex >= newConfig.stintSequence.length) {
            // Current stint index is out of bounds from new config. Keep old values for now.
            // This maintains current driver/stint even if display of upcoming stints changes.
        } else {
            resolvedCurrentDriverId = newConfig.stintSequence[state.currentStintIndex]?.driverId || state.currentDriverId;
        }
      } else if (newConfig.stintSequence.length === 0) { 
        resolvedCurrentDriverId = null;
        resolvedCurrentStintIndex = 0;
      }

      return {
        ...state, 
        config: newConfig, 
        currentDriverId: resolvedCurrentDriverId,
        currentStintIndex: resolvedCurrentStintIndex,
        raceFinishTime: newRaceFinishTime,
      };
    }
    case 'START_RACE':
      if (!config) return state;
      const raceStartTime = currentTime;
      const referenceStartTimeForDuration = config.raceOfficialStartTime && Date.parse(config.raceOfficialStartTime) <= currentTime
                                            ? Date.parse(config.raceOfficialStartTime)
                                            : raceStartTime;
      const raceFinishTime = referenceStartTimeForDuration + config.raceDurationMinutes * 60 * 1000;

      return {
        ...state,
        isRaceActive: true,
        isRacePaused: false,
        raceStartTime,
        pauseTime: null,
        accumulatedPauseDuration: 0,
        currentStintIndex: 0,
        currentDriverId: config.stintSequence[0].driverId,
        stintStartTime: raceStartTime,
        fuelTankStartTime: raceStartTime,
        raceFinishTime,
        raceCompleted: false,
        completedStints: [],
      };
    case 'PAUSE_RACE':
      return { ...state, isRacePaused: true, pauseTime: currentTime };
    case 'RESUME_RACE':
      if (!state.pauseTime) return state;
      const pauseDuration = currentTime - state.pauseTime;
      const newAccumulatedPauseDuration = state.accumulatedPauseDuration + pauseDuration;
      return {
        ...state,
        isRacePaused: false,
        pauseTime: null,
        accumulatedPauseDuration: newAccumulatedPauseDuration,
        raceFinishTime: state.raceFinishTime ? state.raceFinishTime + pauseDuration : null,
      };
    case 'RESET_RACE_LOGIC':
      if (!config) return state;
      return {
        ...initialRaceState,
        config: config,
        currentDriverId: config.stintSequence[0]?.driverId || null,
        completedStints: []
      };

    case 'SWAP_DRIVER': {
      if (!config || state.currentDriverId === null || state.stintStartTime === null) return state;

      const { nextDriverId, refuel, nextStintPlannedDuration } = action.payload;
      const currentDriver = config.drivers.find(d => d.id === state.currentDriverId);
      const originalStintConfig = config.stintSequence[state.currentStintIndex];

      const completedStintEntry: CompletedStintEntry = {
        driverId: state.currentDriverId,
        driverName: currentDriver?.name || "N/A",
        stintNumber: state.currentStintIndex + 1,
        startTime: state.stintStartTime,
        endTime: currentTime,
        actualDurationMs: currentTime - state.stintStartTime,
        plannedDurationMinutes: originalStintConfig?.plannedDurationMinutes,
        refuelled: refuel,
      };

      let updatedConfig = config;
      const nextStintActualIndexInSequence = state.currentStintIndex + 1;

      if (nextStintPlannedDuration !== undefined && nextStintActualIndexInSequence < config.stintSequence.length) {
        const newStintSequence = config.stintSequence.map((stint, index) => {
          if (index === nextStintActualIndexInSequence) {
            return { ...stint, plannedDurationMinutes: nextStintPlannedDuration };
          }
          return stint;
        });
        updatedConfig = { ...config, stintSequence: newStintSequence };
      }
     
      return {
        ...state,
        config: updatedConfig,
        currentStintIndex: state.currentStintIndex + 1,
        currentDriverId: nextDriverId,
        stintStartTime: currentTime,
        fuelTankStartTime: refuel ? currentTime : (state.fuelTankStartTime || currentTime),
        completedStints: [...state.completedStints, completedStintEntry],
      };
    }
    case 'TICK':
      if (!state.isRaceActive || state.isRacePaused || !config || state.raceCompleted) return state;

      if (state.raceFinishTime && currentTime >= state.raceFinishTime) {
        let finalCompletedStints = state.completedStints;
        if (state.currentDriverId && state.stintStartTime !== null && state.raceFinishTime) {
          const currentDriver = config.drivers.find(d => d.id === state.currentDriverId);
          const currentStintData = config.stintSequence[state.currentStintIndex];
         
          const finalStintEntry: CompletedStintEntry = {
            driverId: state.currentDriverId,
            driverName: currentDriver?.name || "N/A",
            stintNumber: state.currentStintIndex + 1,
            startTime: state.stintStartTime,
            endTime: state.raceFinishTime,
            actualDurationMs: state.raceFinishTime - state.stintStartTime,
            plannedDurationMinutes: currentStintData?.plannedDurationMinutes,
            refuelled: false, 
          };
          finalCompletedStints = [...state.completedStints, finalStintEntry];
        }
        return { ...state, raceCompleted: true, isRaceActive: false, isRacePaused: false, completedStints: finalCompletedStints };
      }

      const actualFuelTankDurationMinutesForTick = config.fuelDurationMinutes;
      const fuelElapsedTimeMs = state.fuelTankStartTime ? currentTime - state.fuelTankStartTime : 0;
      const fuelDurationMs = actualFuelTankDurationMinutesForTick * 60 * 1000;
      const fuelRemainingMs = Math.max(0, fuelDurationMs - fuelElapsedTimeMs);
      const fuelAlert = fuelRemainingMs < LOW_FUEL_THRESHOLD_MINUTES * 60 * 1000;

      return { ...state, fuelAlertActive: fuelAlert };
   
    case 'UPDATE_STINT_IN_SEQUENCE': {
      if (!state.config) return state;
      const { stintIndex, driverId, plannedDurationMinutes } = action.payload;
      const newStintSequence = [...state.config.stintSequence];
      if (stintIndex >= 0 && stintIndex < newStintSequence.length) {
        newStintSequence[stintIndex] = { driverId, plannedDurationMinutes };
      }
      return { ...state, config: { ...state.config, stintSequence: newStintSequence } };
    }

    case 'ADD_STINT_TO_SEQUENCE': {
      if (!state.config) return state;
      const { driverId, plannedDurationMinutes } = action.payload;
      const newStint: StintEntry = { driverId, plannedDurationMinutes };
      return { ...state, config: { ...state.config, stintSequence: [...state.config.stintSequence, newStint] } };
    }

    case 'DELETE_STINT_FROM_SEQUENCE': {
      if (!state.config) return state;
      const { stintIndex } = action.payload;
      const newStintSequence = [...state.config.stintSequence];
      if (stintIndex >= 0 && stintIndex < newStintSequence.length) {
        newStintSequence.splice(stintIndex, 1);
      }
      
      let newCurrentStintIndex = state.currentStintIndex;
      let newCurrentDriverId = state.currentDriverId;

      if (state.isRaceActive) {
        // If deleting a stint before or at the current active stint, adjust currentStintIndex
        if (stintIndex < state.currentStintIndex) {
          newCurrentStintIndex = state.currentStintIndex - 1;
        } else if (stintIndex === state.currentStintIndex) {
          // Deleting the currently active stint - this is complex.
          // For now, advance to next available or clamp. If no next, this is an issue.
          // This might indicate a need to pause the race or handle more gracefully.
          // Simplest for now: try to set to the 'new' current, or first if current is now invalid
          newCurrentStintIndex = Math.min(stintIndex, newStintSequence.length - 1);
          if (newCurrentStintIndex < 0) newCurrentStintIndex = 0; // if sequence became empty
        }
         newCurrentDriverId = newStintSequence[newCurrentStintIndex]?.driverId || null;

      } else { // Race not active, safe to adjust more freely
         newCurrentStintIndex = state.currentStintIndex >= newStintSequence.length
                               ? Math.max(0, newStintSequence.length -1)
                               : state.currentStintIndex;
         newCurrentDriverId = newStintSequence[newCurrentStintIndex]?.driverId || null;
      }


      return {
        ...state,
        config: { ...state.config, stintSequence: newStintSequence },
        currentStintIndex: newCurrentStintIndex,
        currentDriverId: newCurrentDriverId,
      };
    }

    default:
      return state;
  }
}

const getInitialReducerState = (): CurrentRaceState => {
  let configToUse = DEFAULT_RACE_CONFIG;
  if (typeof window !== 'undefined') {
    try {
      const storedConfig = window.localStorage.getItem(RACE_CONFIG_LOCAL_STORAGE_KEY);
      if (storedConfig) {
        const parsedConfig = JSON.parse(storedConfig);
        if (parsedConfig && Array.isArray(parsedConfig.drivers) && Array.isArray(parsedConfig.stintSequence)) {
            configToUse = parsedConfig;
        } else {
            console.warn("Stored race config in localStorage is malformed, using default.");
        }
      }
    } catch (e) {
      console.warn("Failed to parse race config from localStorage for initial state, using default.", e);
    }
  }
  return {
    ...initialRaceState,
    config: configToUse,
    currentDriverId: configToUse.stintSequence[0]?.driverId || null,
    completedStints: [],
  };
};


export function RaceInterface() {
  const router = useRouter();
  const { toast } = useToast();
  const [raceConfigFromStorage, setRaceConfigFromStorage] = useLocalStorage<RaceConfiguration | null>(RACE_CONFIG_LOCAL_STORAGE_KEY, null);
 
  const [state, dispatch] = useReducer(raceReducer, getInitialReducerState());
 
  const [isDriverSwapDialogOpen, setDriverSwapDialogOpen] = useState(false);
  const [isEditStintDialogOpen, setEditStintDialogOpen] = useState(false);
  const [editingStintInfo, setEditingStintInfo] = useState<{ index: number; driverId: string; plannedDurationMinutes?: number; isAdding: boolean } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [currentClockTime, setCurrentClockTime] = useState(new Date());

  const hasAttemptedInitialLoad = useRef(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const rawSavedState = window.localStorage.getItem(RACE_STATE_LOCAL_STORAGE_KEY_FULL);
      if (rawSavedState) {
        try {
          const parsedState: CurrentRaceState = JSON.parse(rawSavedState);
          if (parsedState && parsedState.config && typeof parsedState.isRaceActive === 'boolean') {
            dispatch({ type: 'SET_FULL_STATE', payload: parsedState });
             toast({ title: "Race Resumed", description: "Loaded saved race progress." });
          } else {
            console.warn("Full race state from localStorage is malformed.");
            window.localStorage.removeItem(RACE_STATE_LOCAL_STORAGE_KEY_FULL);
            // If full state is bad, try to load just config
             if (raceConfigFromStorage) {
                dispatch({ type: 'LOAD_CONFIG', payload: raceConfigFromStorage });
             }
          }
        } catch (e) {
          console.error("Failed to parse full race state from localStorage", e);
          window.localStorage.removeItem(RACE_STATE_LOCAL_STORAGE_KEY_FULL);
          if (raceConfigFromStorage) {
             dispatch({ type: 'LOAD_CONFIG', payload: raceConfigFromStorage });
          }
        }
      } else if (raceConfigFromStorage) {
        // No full state, but config exists, load that.
        dispatch({ type: 'LOAD_CONFIG', payload: raceConfigFromStorage });
      }
      hasAttemptedInitialLoad.current = true;
      setIsLoading(false);
    }
  }, []); // Run only once on mount, raceConfigFromStorage not needed as dep here

  useEffect(() => {
    if (typeof window !== 'undefined' && hasAttemptedInitialLoad.current && state && state.config) { // Ensure state.config is not null
      window.localStorage.setItem(RACE_STATE_LOCAL_STORAGE_KEY_FULL, JSON.stringify(state));
    }
  }, [state]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof raceConfigFromStorage === 'undefined' || !hasAttemptedInitialLoad.current) {
      return;
    }
  
    if (raceConfigFromStorage) {
      if (state.config === null) { // Component just initialized, state.config might be null
        dispatch({ type: 'LOAD_CONFIG', payload: raceConfigFromStorage });
      } else if (JSON.stringify(raceConfigFromStorage) !== JSON.stringify(state.config)) {
        // Config changed from elsewhere (e.g. setup page, another tab)
        toast({
          title: "Configuration Updated",
          description: "Race settings have been updated.",
          variant: "default",
        });
        dispatch({ type: 'LOAD_CONFIG', payload: raceConfigFromStorage });
      }
    } else if (!raceConfigFromStorage && state.config) {
        // Config was cleared from localStorage, but component still holds old one. Reset.
        toast({
          title: "Configuration Cleared",
          description: "Race settings were cleared. Resetting to default.",
          variant: "destructive",
        });
        dispatch({ type: 'LOAD_CONFIG', payload: DEFAULT_RACE_CONFIG });
    }
  }, [raceConfigFromStorage, state.config, dispatch, toast]);
  
  // Persist config changes made internally (e.g., editing a stint on race page)
  useEffect(() => {
    if (typeof window !== 'undefined' && state.config && hasAttemptedInitialLoad.current) {
      if (JSON.stringify(state.config) !== JSON.stringify(raceConfigFromStorage)) {
         setRaceConfigFromStorage(state.config);
      }
    }
  }, [state.config, setRaceConfigFromStorage, raceConfigFromStorage]);


  useEffect(() => {
    const officialStartTimestampFromConfig = state.config?.raceOfficialStartTime ? Date.parse(state.config.raceOfficialStartTime) : null;
    let autoStartTimerId: NodeJS.Timeout | null = null;

    if (officialStartTimestampFromConfig && officialStartTimestampFromConfig > Date.now() && !state.isRaceActive && !state.raceCompleted && state.config) {
      const timeToAutoStart = officialStartTimestampFromConfig - Date.now();
      const currentConfigStartTime = state.config.raceOfficialStartTime;

      autoStartTimerId = setTimeout(() => {
        if (state.config?.raceOfficialStartTime === currentConfigStartTime &&
            Date.now() >= (officialStartTimestampFromConfig || 0) &&
            !state.isRaceActive && !state.raceCompleted) {
           dispatch({ type: 'START_RACE' });
        }
      }, timeToAutoStart);
    }

    const tickIntervalId = setInterval(() => {
      const currentTickTime = Date.now();
      setNow(currentTickTime);
      setCurrentClockTime(new Date(currentTickTime));
      if (state.isRaceActive && !state.isRacePaused && !state.raceCompleted) {
        dispatch({ type: 'TICK', payload: { currentTime: currentTickTime } });
      }
    }, 100);

    return () => {
      clearInterval(tickIntervalId);
      if (autoStartTimerId) clearInterval(autoStartTimerId);
    };
  }, [state.isRaceActive, state.isRacePaused, state.raceCompleted, state.config?.raceOfficialStartTime, state.config, dispatch]);


  const handleStartRace = () => dispatch({ type: 'START_RACE' });
  const handlePauseRace = () => dispatch({ type: 'PAUSE_RACE' });
  const handleResumeRace = () => dispatch({ type: 'RESUME_RACE' });
 
  const handleResetRace = () => {
     const configToResetWith = state.config || raceConfigFromStorage || DEFAULT_RACE_CONFIG;
     dispatch({ type: 'RESET_RACE_LOGIC' }); // RESET_RACE_LOGIC uses existing config in state or default if none
     if (typeof window !== 'undefined') {
       window.localStorage.removeItem(RACE_STATE_LOCAL_STORAGE_KEY_FULL);
       // Also reset the base config to ensure clean state if user navigates away then back
       setRaceConfigFromStorage(configToResetWith); 
     }
     toast({title: "Race Reset", description: "All race progress has been cleared."});
  }

  const handleSwapDriverConfirm = (nextDriverId: string, refuel: boolean, nextStintPlannedDuration?: number) => {
    dispatch({ type: 'SWAP_DRIVER', payload: { nextDriverId, refuel, nextStintPlannedDuration } });
  };

  const handleOpenEditStintDialog = (stintIndexInSequence: number, driverId: string, plannedDuration?: number) => {
    setEditingStintInfo({ index: stintIndexInSequence, driverId, plannedDurationMinutes: plannedDuration, isAdding: false });
    setEditStintDialogOpen(true);
  };

  const handleOpenAddStintDialog = () => {
    if (config && config.drivers.length > 0) {
      setEditingStintInfo({
        index: config.stintSequence.length,
        driverId: config.drivers[0].id,   
        plannedDurationMinutes: config.fuelDurationMinutes,
        isAdding: true,
      });
      setEditStintDialogOpen(true);
    } else {
        toast({ title: "Cannot Add Stint", description: "Add drivers in setup first.", variant: "destructive"});
    }
  };

  const handleEditStintConfirm = (driverId: string, plannedDurationMinutes?: number) => {
    if (editingStintInfo) {
      if (editingStintInfo.isAdding) {
        dispatch({ type: 'ADD_STINT_TO_SEQUENCE', payload: { driverId, plannedDurationMinutes } });
      } else {
        dispatch({ type: 'UPDATE_STINT_IN_SEQUENCE', payload: { stintIndex: editingStintInfo.index, driverId, plannedDurationMinutes } });
      }
    }
    setEditStintDialogOpen(false);
    setEditingStintInfo(null);
  };

  const handleDeleteStint = (stintIndexInSequence: number) => {
    if (window.confirm("Are you sure you want to delete this stint from the sequence? This cannot be undone.")) {
      dispatch({ type: 'DELETE_STINT_FROM_SEQUENCE', payload: { stintIndex: stintIndexInSequence } });
    }
  };


  if (isLoading || !state || !state.config) {
    return (
      <div className="container mx-auto py-8 text-center">
        <p className="text-xl text-muted-foreground">Loading Race Data...</p>
      </div>
    );
  }

  const { config } = state;
  const currentTimeForCalcs = state.isRacePaused && state.pauseTime ? state.pauseTime : now;

  const hasOfficialStartTime = !!(config.raceOfficialStartTime && !isNaN(Date.parse(config.raceOfficialStartTime)));
  const officialStartTimestamp = hasOfficialStartTime ? Date.parse(config.raceOfficialStartTime!) : null;
  const timeToRaceStartMs = officialStartTimestamp && officialStartTimestamp > currentTimeForCalcs ? officialStartTimestamp - currentTimeForCalcs : 0;

  const raceElapsedTimeMs = state.raceStartTime && (state.isRaceActive || state.isRacePaused || state.raceCompleted)
    ? (state.raceCompleted && state.raceFinishTime ? state.raceFinishTime : currentTimeForCalcs) - state.raceStartTime - state.accumulatedPauseDuration
    : 0;

  const raceTimeRemainingMs = state.raceFinishTime && (state.isRaceActive || state.isRacePaused)
    ? Math.max(0, state.raceFinishTime - currentTimeForCalcs)
    : (state.raceCompleted ? 0 : config.raceDurationMinutes * 60 * 1000);

  const stintElapsedTimeMs = state.stintStartTime && state.isRaceActive && !state.isRacePaused
    ? currentTimeForCalcs - state.stintStartTime
    : (state.isRacePaused && state.stintStartTime ? (state.pauseTime || currentTimeForCalcs) - state.stintStartTime : 0) ;


  const actualFuelTankDurationMinutes = config.fuelDurationMinutes;
  const fuelElapsedTimeMs = state.fuelTankStartTime && state.isRaceActive && !state.isRacePaused
    ? currentTimeForCalcs - state.fuelTankStartTime
    : (state.isRacePaused && state.fuelTankStartTime ? (state.pauseTime || currentTimeForCalcs) - state.fuelTankStartTime : 0);

  const fuelTimeRemainingMs = Math.max(0, (actualFuelTankDurationMinutes * 60 * 1000) - fuelElapsedTimeMs);
  const fuelPercentage = Math.max(0, (fuelTimeRemainingMs / (actualFuelTankDurationMinutes * 60 * 1000)) * 100);

  const currentDriver = config.drivers.find(d => d.id === state.currentDriverId);
  const currentStintConfig = state.currentStintIndex < config.stintSequence.length ? config.stintSequence[state.currentStintIndex] : null;
  const currentStintPlannedDurationMinutes = currentStintConfig?.plannedDurationMinutes || config.fuelDurationMinutes;

  const nextPlannedDriverIndex = state.currentStintIndex + 1;
  const nextPlannedStintEntry = nextPlannedDriverIndex < config.stintSequence.length ? config.stintSequence[nextPlannedDriverIndex] : null;
  const nextPlannedDriverId = nextPlannedStintEntry?.driverId || null;
  const nextStintOriginalPlannedDurationMinutes = nextPlannedDriverIndex < config.stintSequence.length ? config.stintSequence[nextPlannedDriverIndex]?.plannedDurationMinutes : undefined;


  const raceNotYetStartedAndHasFutureStartTime = timeToRaceStartMs > 0 && !state.isRaceActive && !state.raceCompleted;
  const canDisplayUpcomingStintsList = config.stintSequence.length > 0 && !state.raceCompleted; // Simplified: show if sequence exists and race not done
  const canDisplayCompletedStintsList = state.completedStints && state.completedStints.length > 0;
 
  const isLoadingRaceTimeRemaining = !state.isRaceActive && !state.isRacePaused && !state.raceCompleted && !raceNotYetStartedAndHasFutureStartTime && raceTimeRemainingMs === config.raceDurationMinutes * 60 * 1000;
  const isLoadingStintTime = (!state.isRaceActive && !state.isRacePaused && !state.raceCompleted) || raceNotYetStartedAndHasFutureStartTime;
  const isLoadingFuelTime = (!state.isRaceActive && !state.isRacePaused && !state.raceCompleted) || raceNotYetStartedAndHasFutureStartTime;
  const isLoadingElapsedTime = !state.isRaceActive && !state.isRacePaused && !state.raceCompleted && raceElapsedTimeMs === 0 && !raceNotYetStartedAndHasFutureStartTime;


  return (
    <div className="container mx-auto py-8 px-4">
      {raceNotYetStartedAndHasFutureStartTime && officialStartTimestamp && (
        <Card className="mb-6 bg-accent/10 border-accent shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-2xl text-accent flex items-center">
              <TimerIcon className="mr-2 h-7 w-7" /> Race Starts In
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <TimerDisplay label="" timeMs={timeToRaceStartMs} isLoading={false} variant="warning" />
          </CardContent>
        </Card>
      )}

      <Card className="mb-8 shadow-xl border-primary/20">
        <CardHeader className="pb-4">
          <CardTitle className="text-3xl font-bold text-primary flex items-center">
            <Flag className="mr-3 h-8 w-8" /> Race Monitor
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <TimerDisplay label="Race Time Remaining" timeMs={raceTimeRemainingMs} isLoading={isLoadingRaceTimeRemaining} />
          <TimerDisplay label="Elapsed Race Time" timeMs={raceElapsedTimeMs} isLoading={isLoadingElapsedTime} />
           <div className="text-center p-4 rounded-lg shadow-md bg-card border">
            <div className="text-sm font-medium text-muted-foreground mb-1">Current Clock Time</div>
            <div className="text-4xl font-mono font-bold tracking-wider text-foreground flex items-center justify-center">
              <Clock className="mr-2 h-7 w-7" />
              {currentClockTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
          </div>
        </CardContent>
      </Card>

      {state.fuelAlertActive && !state.raceCompleted && (
        <Alert variant="destructive" className="mb-6 border-accent bg-accent/10 text-accent-foreground">
          <AlertTriangle className="h-5 w-5 text-accent" />
          <AlertTitle className="text-accent font-semibold">Low Fuel Warning!</AlertTitle>
          <AlertDescription>
            Fuel is running low. Prepare for a pit stop.
          </AlertDescription>
        </Alert>
      )}

      {state.raceCompleted && (
         <Alert variant="default" className="mb-6 border-primary bg-primary/10 text-primary-foreground">
          <Flag className="h-5 w-5 text-primary" />
          <AlertTitle className="text-primary font-semibold">Race Finished!</AlertTitle>
          <AlertDescription>
            The race has concluded. Total elapsed time: {formatTime(raceElapsedTimeMs)}.
          </AlertDescription>
        </Alert>
      )}

      <Card className="shadow-lg mb-6">
        <CardHeader>
            <CardTitle className="text-xl font-semibold text-primary">Current Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 items-baseline">
            <div>
              <p className="text-sm text-muted-foreground">Current Driver</p>
              <p className="text-2xl font-semibold text-primary">{currentDriver?.name || "N/A"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Next Planned Driver</p>
              <p className="text-xl font-medium">
                {state.currentStintIndex +1 >= config.stintSequence.length ? "End of sequence" : (config.drivers.find(d => d.id === config.stintSequence[state.currentStintIndex+1]?.driverId)?.name || "N/A")}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Stint</p>
              <p className="text-2xl font-semibold">{state.currentStintIndex + 1} / {config.stintSequence.length || 'N/A'}</p>
            </div>
             <div>
              <p className="text-sm text-muted-foreground">Planned Stint Duration</p>
              <p className="text-xl font-medium">{currentStintPlannedDurationMinutes} min</p>
            </div>
          </div>
         
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TimerDisplay label="Current Driver Time" timeMs={stintElapsedTimeMs} isLoading={isLoadingStintTime} />
              <TimerDisplay
                  label="Fuel Time Remaining"
                  timeMs={fuelTimeRemainingMs}
                  variant={state.fuelAlertActive ? "warning" : "default"}
                  isLoading={isLoadingFuelTime}
              />
          </div>
          <div>
            <Label className="text-sm text-muted-foreground">Fuel Level ({actualFuelTankDurationMinutes} min tank)</Label>
            <Progress value={fuelPercentage} className="w-full h-3 mt-1 [&>div]:bg-primary" />
            <p className="text-xs text-right text-muted-foreground mt-0.5">{fuelPercentage.toFixed(0)}%</p>
          </div>
        </CardContent>
      </Card>
     
      {(state.isRaceActive && !state.raceCompleted) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-6">
            {!state.isRacePaused && (
                <Button onClick={handlePauseRace} variant="outline" size="lg" className="w-full">
                    <Pause className="mr-2 h-5 w-5" /> Pause Race
                </Button>
            )}
            {state.isRacePaused && (
                <Button onClick={handleResumeRace} size="lg" className="w-full bg-primary hover:bg-primary/80 text-primary-foreground">
                    <Play className="mr-2 h-5 w-5" /> Resume Race
                </Button>
            )}
            <Button
                onClick={() => setDriverSwapDialogOpen(true)}
                size="lg"
                disabled={state.isRacePaused || state.currentStintIndex >= config.stintSequence.length -1}
                className="w-full"
            >
                <Users className="mr-2 h-5 w-5" /> Swap Driver
            </Button>
        </div>
      )}

      {canDisplayUpcomingStintsList && (
        <Card className="shadow-lg mb-6">
          <CardHeader>
            <CardTitle className="text-xl font-semibold text-primary flex items-center">
              <Users className="mr-2 h-5 w-5" /> Upcoming Stints
            </CardTitle>
              <UICardDescription>
                {state.isRaceActive && !state.isRacePaused ? "Dynamically updated planned start times." : ((hasOfficialStartTime || state.config?.stintSequence.some(s => s.plannedDurationMinutes)) ? "Planned times based on official start or sequence durations." : "Sequence of drivers.")}
                 {state.isRacePaused && " (Race Paused - ETAs might shift upon resume)"}
              </UICardDescription>
          </CardHeader>
          <CardContent>
            <div>
              {(() => {
                  const upcomingStintsToRender = [];
                  let nextStintBaseTimeMs: number;

                  if (state.isRaceActive && state.stintStartTime !== null && state.config && !state.isRacePaused) {
                      nextStintBaseTimeMs = currentTimeForCalcs;
                  } else if (state.isRacePaused && state.stintStartTime !== null && state.config && state.pauseTime) {
                      if (officialStartTimestamp) { 
                            nextStintBaseTimeMs = officialStartTimestamp;
                            for (let k=0; k <= state.currentStintIndex; k++) { 
                                const stintDurationMs = (state.config.stintSequence[k]?.plannedDurationMinutes || state.config.fuelDurationMinutes) * 60000;
                                nextStintBaseTimeMs += stintDurationMs;
                            }
                            nextStintBaseTimeMs += state.accumulatedPauseDuration; 
                        } else {
                             const currentStintData = state.config.stintSequence[state.currentStintIndex];
                             const currentStintPlannedDurationMs = (currentStintData?.plannedDurationMinutes || state.config.fuelDurationMinutes) * 60000;
                             nextStintBaseTimeMs = state.stintStartTime + currentStintPlannedDurationMs + state.accumulatedPauseDuration;
                        }
                  } else if ((hasOfficialStartTime || state.config?.stintSequence.some(s => s.plannedDurationMinutes)) && state.config) {
                      nextStintBaseTimeMs = officialStartTimestamp || currentTimeForCalcs;
                      if (hasOfficialStartTime && state.config.stintSequence.length > 0) {
                        const firstStintDurationMs = (state.config.stintSequence[0]?.plannedDurationMinutes || state.config.fuelDurationMinutes) * 60000;
                        nextStintBaseTimeMs = officialStartTimestamp + firstStintDurationMs; // Base for the *second* stint if first exists
                      } else if (state.config.stintSequence.length > 0) {
                           const firstStintDurationMs = (state.config.stintSequence[0]?.plannedDurationMinutes || state.config.fuelDurationMinutes) * 60000;
                           nextStintBaseTimeMs = currentTimeForCalcs + firstStintDurationMs;
                      }
                  } else {
                      nextStintBaseTimeMs = 0;
                  }

                  let cumulativeDurationForUpcomingMs = 0;

                  if (state.config) {
                      const startIndexForUpcoming = state.isRaceActive || state.isRacePaused ? state.currentStintIndex + 1 : 0;

                      if ((state.isRaceActive || state.isRacePaused) && state.stintStartTime !== null && !state.isRacePaused ) {
                         const currentStintConfigData = state.config.stintSequence[state.currentStintIndex];
                         const currentStintPlannedDurationMsForCalc = (currentStintConfigData?.plannedDurationMinutes || state.config.fuelDurationMinutes) * 60000;
                         const currentStintRemainingMs = Math.max(0, currentStintPlannedDurationMsForCalc - stintElapsedTimeMs);
                         nextStintBaseTimeMs = currentTimeForCalcs + currentStintRemainingMs;
                      } else if (state.isRacePaused && state.stintStartTime !== null) {
                        if (!officialStartTimestamp) { 
                            // Already calculated above if based on officialStartTimestamp + accumulated durations
                            // If based on current stint start + planned duration:
                            // const currentStintData = state.config.stintSequence[state.currentStintIndex];
                            // const currentStintPlannedDurationMs = (currentStintData?.plannedDurationMinutes || state.config.fuelDurationMinutes) * 60000;
                            // nextStintBaseTimeMs = state.stintStartTime + currentStintPlannedDurationMs + state.accumulatedPauseDuration;
                            // The above logic for paused state already sets nextStintBaseTimeMs correctly based on official or stint start.
                        }
                      }


                      for (let i = startIndexForUpcoming; i < state.config.stintSequence.length; i++) {
                        const stintEntry = state.config.stintSequence[i];
                        const driver = state.config.drivers.find(d => d.id === stintEntry.driverId);
                        const stintPlannedDurationMinutes = stintEntry.plannedDurationMinutes || state.config.fuelDurationMinutes;

                        let thisStintExpectedStartTimeMs: number | null = null;
                        let isPotentiallyTooLate = false;
                        let remainingRaceTimeAtSwapText: string | null = null;

                        if (nextStintBaseTimeMs !== 0) {
                            thisStintExpectedStartTimeMs = nextStintBaseTimeMs + cumulativeDurationForUpcomingMs;
                           
                            if (state.raceFinishTime && thisStintExpectedStartTimeMs >= state.raceFinishTime) {
                                isPotentiallyTooLate = true;
                            } else if (state.raceFinishTime) {
                                const remainingMs = state.raceFinishTime - thisStintExpectedStartTimeMs;
                                remainingRaceTimeAtSwapText = `Race time left: ${formatTime(remainingMs)}`;
                            }
                            cumulativeDurationForUpcomingMs += stintPlannedDurationMinutes * 60000;
                        }
                       
                        upcomingStintsToRender.push(
                          <li key={`${stintEntry.driverId}-${i}`} className={`p-3 rounded-md border flex justify-between items-center bg-muted/30`}>
                            <div className="flex-grow">
                              <p className={`font-medium`}>{driver?.name || "N/A"}</p>
                              <p className="text-xs text-muted-foreground">
                                Stint #{i + 1} ({stintPlannedDurationMinutes} min)
                              </p>
                              {thisStintExpectedStartTimeMs !== null && nextStintBaseTimeMs !== 0 ? (
                                <>
                                  <p className={cn("text-xs font-semibold", isPotentiallyTooLate ? "text-accent" : "text-primary")}>
                                    {isPotentiallyTooLate && <AlertTriangle className="inline-block h-3 w-3 mr-1 align-text-bottom text-accent" />}
                                    ETA: {new Date(thisStintExpectedStartTimeMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    {new Date(thisStintExpectedStartTimeMs).toLocaleDateString() !== new Date(currentTimeForCalcs).toLocaleDateString() &&
                                      ` (${new Date(thisStintExpectedStartTimeMs).toLocaleDateString([], {month: 'short', day: 'numeric'})})`}
                                    {isPotentiallyTooLate && " (After race finish)"}
                                  </p>
                                  {remainingRaceTimeAtSwapText && !isPotentiallyTooLate && (
                                    <p className="text-xs text-muted-foreground">{remainingRaceTimeAtSwapText}</p>
                                  )}
                                </>
                              ) : (
                                  <p className="text-xs text-muted-foreground">
                                    Planned Duration: {stintPlannedDurationMinutes} min
                                    {state.isRacePaused && !hasOfficialStartTime && " (ETA calculation paused or needs official start)"}
                                  </p>
                              )}
                            </div>
                            {!state.raceCompleted && (
                              <div className="flex items-center">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleOpenEditStintDialog(i, stintEntry.driverId, stintEntry.plannedDurationMinutes)}
                                  className="ml-2"
                                  aria-label="Edit Stint"
                                  disabled={state.isRacePaused || (state.isRaceActive && i < state.currentStintIndex +1)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteStint(i)}
                                  className="ml-1 text-destructive hover:text-destructive/80"
                                  aria-label="Delete Stint"
                                  disabled={state.isRacePaused || (state.isRaceActive && i < state.currentStintIndex +1)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            )}
                          </li>
                        );
                      }
                  }

                  if (upcomingStintsToRender.length === 0) {
                    return <p className="text-muted-foreground text-sm">
                      {config.stintSequence.length === 0 ? "No stints planned." : ( (state.isRaceActive && state.currentStintIndex >= config.stintSequence.length -1) || state.raceCompleted ? "Final stint or all stints complete." : "No upcoming stints to display under current filter or race not started.")}
                    </p>;
                  }
                  return (
                      <>
                          <ul className="space-y-3">{upcomingStintsToRender}</ul>
                          {!state.raceCompleted && (
                              <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={handleOpenAddStintDialog}
                                  className="mt-4 w-full"
                                  disabled={config.drivers.length === 0 || state.isRacePaused}
                              >
                                  <PlusCircle className="mr-2 h-4 w-4" /> Add Stint
                              </Button>
                          )}
                      </>
                  );
                })()}
            </div>
          </CardContent>
        </Card>
      )}

      {canDisplayCompletedStintsList && (
        <Card className="shadow-lg mb-8">
          <CardHeader>
            <CardTitle className="text-xl font-semibold text-primary flex items-center">
              <History className="mr-2 h-5 w-5" /> Completed Stints
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">Stint</TableHead>
                  <TableHead>Driver</TableHead>
                  <TableHead className="text-right">Actual Duration</TableHead>
                  <TableHead className="text-right">Completed At</TableHead>
                  <TableHead className="text-center">Refuelled?</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.completedStints.slice().reverse().map((stint, index) => (
                  <TableRow key={`${stint.driverId}-${stint.stintNumber}-${index}`}>
                    <TableCell className="font-medium">#{stint.stintNumber}</TableCell>
                    <TableCell>{stint.driverName}</TableCell>
                    <TableCell className="text-right">{formatTime(stint.actualDurationMs)}</TableCell>
                    <TableCell className="text-right">
                      {new Date(stint.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </TableCell>
                    <TableCell className="text-center">{stint.refuelled ? "Yes" : "No"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
     
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8">
        {!state.isRaceActive && !state.raceCompleted && (
          <Button
            onClick={handleStartRace}
            size="lg"
            className="w-full bg-primary hover:bg-primary/80 text-primary-foreground"
            disabled={raceNotYetStartedAndHasFutureStartTime || state.isRacePaused}
          >
            <Play className="mr-2 h-5 w-5" /> Start Race
          </Button>
        )}
        <Button
          onClick={handleResetRace}
          variant="destructive"
          size="lg"
          className={cn(
                "w-full",
                 (!state.isRaceActive && !state.raceCompleted) ? "sm:col-span-1" : "sm:col-span-2" // Full width if Start button not shown
            )}
          disabled={raceNotYetStartedAndHasFutureStartTime && !state.isRaceActive && !state.isRacePaused && !state.raceCompleted}
        >
          <RotateCcw className="mr-2 h-5 w-5" /> Reset Race Data
        </Button>
      </div>

      <DriverSwapDialog
        isOpen={isDriverSwapDialogOpen}
        onClose={() => setDriverSwapDialogOpen(false)}
        onConfirm={handleSwapDriverConfirm}
        currentDriverId={state.currentDriverId}
        config={config}
        nextPlannedDriverId={nextPlannedDriverId}
        nextStintOriginalPlannedDurationMinutes={nextStintOriginalPlannedDurationMinutes || config.fuelDurationMinutes}
      />
      {editingStintInfo && (
        <EditStintDialog
            isOpen={isEditStintDialogOpen}
            onClose={() => { setEditStintDialogOpen(false); setEditingStintInfo(null); }}
            onConfirm={handleEditStintConfirm}
            availableDrivers={config.drivers}
            initialDriverId={editingStintInfo.driverId}
            initialDuration={editingStintInfo.plannedDurationMinutes}
            defaultDuration={config.fuelDurationMinutes}
            isAdding={editingStintInfo.isAdding}
        />
      )}
    </div>
  );
}

