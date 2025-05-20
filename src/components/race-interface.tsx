
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
import { ScrollArea } from '@/components/ui/scroll-area';


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
      // If loaded state was paused, calculate how much time passed while "offline"
      if (loadedState.isRacePaused && loadedState.pauseTime) {
        const offlinePauseDuration = Math.max(0, currentTime - loadedState.pauseTime);
        loadedState = {
          ...loadedState,
          // Add offline pause duration to accumulated
          accumulatedPauseDuration: loadedState.accumulatedPauseDuration + offlinePauseDuration,
          // Update pauseTime to current time as if pause just happened now
          pauseTime: currentTime,
          // Adjust raceFinishTime if it was set
          raceFinishTime: loadedState.raceFinishTime ? loadedState.raceFinishTime + offlinePauseDuration : null,
        };
      }
      // Re-evaluate fuel alert active based on current time and loaded fuel state
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
      // Preserve runtime state, apply new config
      // Calculate newRaceFinishTime based on potential changes in newConfig.raceDurationMinutes
      let newRaceFinishTime = state.raceFinishTime;
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

      // If race is not active, and new config has stints, try to set current driver from new sequence
      if (!state.isRaceActive && newConfig.stintSequence.length > 0) {
        resolvedCurrentStintIndex = 0;
        resolvedCurrentDriverId = newConfig.stintSequence[0].driverId;
      } else if (state.isRaceActive && newConfig.stintSequence.length > 0) {
        // If race active, ensure current stint index is valid for new sequence length
        if (state.currentStintIndex >= newConfig.stintSequence.length) {
            // Current stint index is out of bounds from new config.
            // This can happen if stints were deleted from setup that included the current/upcoming one.
            // Try to keep the current driver if they still exist in the new driver list,
            // otherwise, might need to reset to the first driver of the new sequence or handle as an error/pause.
            // For now, if current driver is no longer in the new config's driver list, default to first of new sequence.
            if (!newConfig.drivers.some(d => d.id === state.currentDriverId)) {
                resolvedCurrentDriverId = newConfig.stintSequence[0]?.driverId || null;
                resolvedCurrentStintIndex = 0; // Reset index as driver changed
            } else {
                // Current driver is still valid, but index might be out of bounds.
                // Clamp index to the new sequence length. This might mean "current" stint effectively changes.
                resolvedCurrentStintIndex = Math.min(state.currentStintIndex, newConfig.stintSequence.length - 1);
                // Update driver ID from the (potentially new) current stint in sequence
                resolvedCurrentDriverId = newConfig.stintSequence[resolvedCurrentStintIndex]?.driverId || state.currentDriverId;
            }
        } else {
            // Current stint index is within new sequence bounds, update driverId from it to ensure consistency
            resolvedCurrentDriverId = newConfig.stintSequence[state.currentStintIndex]?.driverId || state.currentDriverId;
        }
      } else if (newConfig.stintSequence.length === 0) { // If new config has no stints
        resolvedCurrentDriverId = null;
        resolvedCurrentStintIndex = 0;
      }
      // If no drivers configured at all, ensure currentDriverId is null
      if (newConfig.drivers.length === 0) {
        resolvedCurrentDriverId = null;
        resolvedCurrentStintIndex = 0;
      }


      return {
        ...state, // Spread existing state first
        config: newConfig, // Then apply the new configuration
        currentDriverId: resolvedCurrentDriverId,
        currentStintIndex: resolvedCurrentStintIndex,
        raceFinishTime: newRaceFinishTime,
        // Important: Do NOT reset completedStints or other runtime progress here
        // as this action is now meant to merge config, not fully reset.
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
        accumulatedPauseDuration: 0, // Reset accumulated pause on new start
        currentStintIndex: 0,
        currentDriverId: config.stintSequence[0].driverId,
        stintStartTime: raceStartTime,
        fuelTankStartTime: raceStartTime,
        raceFinishTime,
        raceCompleted: false,
        completedStints: [], // Reset completed stints on new start
      };
    case 'PAUSE_RACE':
      return { ...state, isRacePaused: true, pauseTime: currentTime };
    case 'RESUME_RACE':
      if (!state.pauseTime) return state; // Should not happen
      const pauseDuration = currentTime - state.pauseTime;
      const newAccumulatedPauseDuration = state.accumulatedPauseDuration + pauseDuration;
      return {
        ...state,
        isRacePaused: false,
        pauseTime: null,
        accumulatedPauseDuration: newAccumulatedPauseDuration,
        // Adjust finish time by the duration of this specific pause
        raceFinishTime: state.raceFinishTime ? state.raceFinishTime + pauseDuration : null,
      };
    case 'RESET_RACE_LOGIC': // Renamed from RESET_RACE
      if (!config) return state; // Should ideally always have a config
      return {
        ...initialRaceState, // Use the base initial state
        config: config, // Re-apply the current config
        currentDriverId: config.stintSequence[0]?.driverId || null, // Set initial driver from current config
        completedStints: [] // Ensure completed stints are cleared
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
        plannedDurationMinutes: originalStintConfig?.plannedDurationMinutes, // Log the original plan
        refuelled: refuel, // Log if refuel occurred
      };

      let updatedConfig = config;
      const nextStintActualIndexInSequence = state.currentStintIndex + 1;

      // If a planned duration for the *next* stint was provided via dialog, update config
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
        config: updatedConfig, // Persist changes to stint planned durations
        currentStintIndex: state.currentStintIndex + 1,
        currentDriverId: nextDriverId,
        stintStartTime: currentTime,
        // Fuel tank start time resets only if refuel is true
        fuelTankStartTime: refuel ? currentTime : (state.fuelTankStartTime || currentTime),
        completedStints: [...state.completedStints, completedStintEntry],
      };
    }
    case 'TICK':
      if (!state.isRaceActive || state.isRacePaused || !config || state.raceCompleted) return state;

      // Check for race completion
      if (state.raceFinishTime && currentTime >= state.raceFinishTime) {
        let finalCompletedStints = state.completedStints;
        // If current driver/stint was active when race ended, log it as completed
        if (state.currentDriverId && state.stintStartTime !== null && state.raceFinishTime) { // ensure raceFinishTime is not null
          const currentDriver = config.drivers.find(d => d.id === state.currentDriverId);
          const currentStintData = config.stintSequence[state.currentStintIndex];
         
          // Check if this final stint is already in completedStints (e.g. if race ends exactly on a swap)
          // This check might be overly cautious or unnecessary depending on exact desired behavior at finish line.
          const alreadyLogged = state.completedStints.some(
            cs => cs.stintNumber === state.currentStintIndex + 1 && cs.driverId === state.currentDriverId
          );

          if (!alreadyLogged) {
            const finalStintEntry: CompletedStintEntry = {
              driverId: state.currentDriverId,
              driverName: currentDriver?.name || "N/A",
              stintNumber: state.currentStintIndex + 1,
              startTime: state.stintStartTime,
              endTime: state.raceFinishTime, // Stint ends exactly when race ends
              actualDurationMs: state.raceFinishTime - state.stintStartTime,
              plannedDurationMinutes: currentStintData?.plannedDurationMinutes,
              refuelled: false, // No explicit refuel action at race end
            };
            finalCompletedStints = [...state.completedStints, finalStintEntry];
          }
        }
        return { ...state, raceCompleted: true, isRaceActive: false, isRacePaused: false, completedStints: finalCompletedStints };
      }

      // Fuel alert logic
      const actualFuelTankDurationMinutesForTick = config.fuelDurationMinutes; // Always use global fuel duration
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
      
      // Adjust currentStintIndex if a stint before or at the current one was deleted
      // This logic is simplified; more robust handling might be needed for edge cases
      // especially if deleting the *currently active* stint during a race.
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
                               ? Math.max(0, newStintSequence.length -1) // Clamp to last valid index or 0
                               : state.currentStintIndex; // Stays same if still valid
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

// Function to get initial state for the reducer
const getInitialReducerState = (): CurrentRaceState => {
  let configToUse = DEFAULT_RACE_CONFIG; // Start with default
  if (typeof window !== 'undefined') {
    try {
      // Attempt to load config specific storage first
      const storedConfig = window.localStorage.getItem(RACE_CONFIG_LOCAL_STORAGE_KEY);
      if (storedConfig) {
        const parsedConfig = JSON.parse(storedConfig);
        // Basic validation for parsedConfig structure
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
  // Return initialRaceState spread with the determined configToUse
  // and ensure currentDriverId is set based on this config.
  return {
    ...initialRaceState, // This sets isRaceActive: false, completedStints: [], etc.
    config: configToUse,
    currentDriverId: configToUse.stintSequence[0]?.driverId || null,
    completedStints: [], // Ensure this is explicitly empty for the initial state before full state load
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
  const [isLoading, setIsLoading] = useState(true); // Used to delay full state save until initial load is attempted
  const [now, setNow] = useState(Date.now()); // For triggering re-renders for timers
  const [currentClockTime, setCurrentClockTime] = useState(new Date()); // For displaying current clock time

  const hasAttemptedInitialLoad = useRef(false); // Ref to track if initial load from localStorage has been attempted

  // Effect for initial loading of persisted full state (runs once on mount)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const rawSavedState = window.localStorage.getItem(RACE_STATE_LOCAL_STORAGE_KEY_FULL);
      if (rawSavedState) {
        try {
          const parsedState: CurrentRaceState = JSON.parse(rawSavedState);
          // Basic validation of parsed state structure
          if (parsedState && parsedState.config && typeof parsedState.isRaceActive === 'boolean') {
            dispatch({ type: 'SET_FULL_STATE', payload: parsedState });
            //  toast({ title: "Race Resumed", description: "Loaded saved race progress." });
          } else {
            console.warn("Full race state from localStorage is malformed. Clearing it and attempting to load config only.");
            window.localStorage.removeItem(RACE_STATE_LOCAL_STORAGE_KEY_FULL); // Clear malformed state
            // If full state is bad, try to load just config as a fallback
             if (raceConfigFromStorage) { // raceConfigFromStorage is from useLocalStorage hook
                dispatch({ type: 'LOAD_CONFIG', payload: raceConfigFromStorage });
             }
          }
        } catch (e) {
          console.error("Failed to parse full race state from localStorage", e);
          window.localStorage.removeItem(RACE_STATE_LOCAL_STORAGE_KEY_FULL); // Clear on error
          if (raceConfigFromStorage) { // Fallback to config only
             dispatch({ type: 'LOAD_CONFIG', payload: raceConfigFromStorage });
          }
        }
      } else if (raceConfigFromStorage) {
        // No full state, but config exists from its dedicated storage, load that.
        // This handles the case where user has setup config but never started/saved a race.
        dispatch({ type: 'LOAD_CONFIG', payload: raceConfigFromStorage });
      }
      // else: No full state and no separate config. Reducer is already initialized with defaults.
      hasAttemptedInitialLoad.current = true;
      setIsLoading(false); // Mark initial load attempt as complete
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only once. raceConfigFromStorage is not needed here as initial value is passed to useReducer.

  // Effect for saving the entire current race state to localStorage whenever `state` changes
  useEffect(() => {
    // Only save if initial load has been attempted and state/config are valid
    if (typeof window !== 'undefined' && hasAttemptedInitialLoad.current && state && state.config) {
      window.localStorage.setItem(RACE_STATE_LOCAL_STORAGE_KEY_FULL, JSON.stringify(state));
    }
  }, [state]); // This effect runs whenever the `state` object reference changes

  // Effect for reacting to changes in `raceConfigFromStorage` (e.g., updated from Setup page)
  useEffect(() => {
    if (typeof window === 'undefined' || !hasAttemptedInitialLoad.current) {
      return; // Wait for initial load attempt to complete
    }
  
    // This effect is now intended to react to changes in raceConfigFromStorage
    // that are considered "external" (e.g., from Setup page or another tab syncing via localStorage event).
  
    if (raceConfigFromStorage) {
      // If state.config is null, it means we haven't fully initialized runtime state yet from full state persistence,
      // or the race was reset. So, load the config.
      // If state.config exists, only load if raceConfigFromStorage is TRULY different,
      // indicating an external change that needs to be merged.
      if (state.config === null || JSON.stringify(raceConfigFromStorage) !== JSON.stringify(state.config)) {
        // console.log("Change in raceConfigFromStorage detected. Current state.config:", state.config, "New raceConfigFromStorage:", raceConfigFromStorage);
        if (state.config !== null) { // Only toast if it's an update, not an initial config load into a null state.config
            toast({
                title: "Configuration Synced",
                description: "Race settings have been updated from storage.",
                variant: "default",
            });
        }
        dispatch({ type: 'LOAD_CONFIG', payload: raceConfigFromStorage });
      }
    } else if (state.config !== null) {
      // raceConfigFromStorage is null (e.g., cleared externally), but we have an active config in state.
      // This implies the stored config was deleted. Reset to default.
      // console.log("raceConfigFromStorage is null, but state.config exists. Resetting to default.");
      toast({
        title: "Configuration Cleared",
        description: "Race settings were cleared from storage. Resetting to default.",
        variant: "destructive",
      });
      dispatch({ type: 'LOAD_CONFIG', payload: DEFAULT_RACE_CONFIG });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceConfigFromStorage, dispatch]); // state.config is INTENTIONALLY OMITTED from deps to break update loops.
                                         // This effect should ONLY fire when raceConfigFromStorage itself changes.
                                         // It then compares against the current `state.config` from the closure.
                                         // toast is also omitted as it's stable.


  // Effect for persisting changes made to `state.config` internally (e.g., editing a stint)
  // back to `RACE_CONFIG_LOCAL_STORAGE_KEY` so Setup page can see them.
  useEffect(() => {
    if (typeof window !== 'undefined' && state.config && hasAttemptedInitialLoad.current) {
      // Compare `state.config` (our current in-memory truth) with `raceConfigFromStorage` (what's in dedicated config LS)
      // If they are different, it means an internal action (like editing a stint) changed `state.config`,
      // so we need to update `raceConfigFromStorage` to reflect this.
      const currentStoredConfigString = raceConfigFromStorage ? JSON.stringify(raceConfigFromStorage) : null;
      if (JSON.stringify(state.config) !== currentStoredConfigString) {
         setRaceConfigFromStorage(state.config); // This updates the useLocalStorage value, which in turn updates localStorage.
      }
    }
  }, [state.config, setRaceConfigFromStorage, raceConfigFromStorage]); // Depends on these to correctly sync out.
  

  // Timer interval for updating 'now', current clock time, and dispatching 'TICK'
  useEffect(() => {
    const officialStartTimestampFromConfig = state.config?.raceOfficialStartTime ? Date.parse(state.config.raceOfficialStartTime) : null;
    let autoStartTimerId: NodeJS.Timeout | null = null;

    // Auto-start logic
    if (officialStartTimestampFromConfig && officialStartTimestampFromConfig > Date.now() && !state.isRaceActive && !state.raceCompleted && state.config) {
      const timeToAutoStart = officialStartTimestampFromConfig - Date.now();
      const currentConfigStartTime = state.config.raceOfficialStartTime; // Closure for timeout check

      autoStartTimerId = setTimeout(() => {
        // Check if config still matches and race hasn't started by other means
        if (state.config?.raceOfficialStartTime === currentConfigStartTime &&
            Date.now() >= (officialStartTimestampFromConfig || 0) && // Ensure timestamp is valid
            !state.isRaceActive && !state.raceCompleted) {
           dispatch({ type: 'START_RACE' });
        }
      }, timeToAutoStart);
    }

    // Main tick interval
    const tickIntervalId = setInterval(() => {
      const currentTickTime = Date.now();
      setNow(currentTickTime); // Update 'now' for general timer displays
      setCurrentClockTime(new Date(currentTickTime)); // Update displayed clock time

      // Dispatch 'TICK' only if race is active and not paused/completed
      if (state.isRaceActive && !state.isRacePaused && !state.raceCompleted) {
        dispatch({ type: 'TICK', payload: { currentTime: currentTickTime } });
      }
    }, 100); // Update displays frequently, TICK action handles its own logic

    return () => {
      clearInterval(tickIntervalId);
      if (autoStartTimerId) clearInterval(autoStartTimerId);
    };
  }, [state.isRaceActive, state.isRacePaused, state.raceCompleted, state.config?.raceOfficialStartTime, state.config, dispatch]); // `dispatch` is stable, `state.config` for auto-start conditions


  const handleStartRace = () => dispatch({ type: 'START_RACE' });
  const handlePauseRace = () => dispatch({ type: 'PAUSE_RACE' });
  const handleResumeRace = () => dispatch({ type: 'RESUME_RACE' });
 
  const handleResetRace = () => {
     // Use the config currently in state for the reset, or fallback if state.config is somehow null
     const configToResetWith = state.config || raceConfigFromStorage || DEFAULT_RACE_CONFIG;
     
     // Dispatch an action to reset the race logic using the determined config
     dispatch({ type: 'LOAD_CONFIG', payload: configToResetWith }); // LOAD_CONFIG will apply this config over initial state
     // This needs to be followed by a more specific reset if LOAD_CONFIG doesn't fully reset runtime state
     dispatch({ type: 'RESET_RACE_LOGIC' }); // This ensures runtime state like timers, completedStints are reset

     if (typeof window !== 'undefined') {
       // Crucially, clear the persisted *full race state* from local storage
       window.localStorage.removeItem(RACE_STATE_LOCAL_STORAGE_KEY_FULL);
       // Also ensure the base config in its separate storage is set to what we reset with,
       // so if user navigates to Setup, it reflects this reset state.
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
        index: config.stintSequence.length, // Index for the new stint will be current length
        driverId: config.drivers[0].id,    // Default to first driver
        plannedDurationMinutes: config.fuelDurationMinutes, // Default to global fuel duration
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
    setEditingStintInfo(null); // Clear editing info
  };

  const handleDeleteStint = (stintIndexInSequence: number) => {
    // Add a confirmation dialog before deleting
    if (window.confirm("Are you sure you want to delete this stint from the sequence? This cannot be undone.")) {
      dispatch({ type: 'DELETE_STINT_FROM_SEQUENCE', payload: { stintIndex: stintIndexInSequence } });
    }
  };


  // UI Rendering Logic & Calculated Values
  // Ensure `state` and `state.config` are checked before use
  if (isLoading || !state || !state.config) { // isLoading is true until initial load attempt from LS is done
    return (
      <div className="container mx-auto py-8 text-center">
        <p className="text-xl text-muted-foreground">Loading Race Data...</p>
        {/* Could add a spinner here */}
      </div>
    );
  }

  // Destructure config from state safely now that we know it exists
  const { config } = state;
  const currentTimeForCalcs = state.isRacePaused && state.pauseTime ? state.pauseTime : now;

  // Race Timers
  const hasOfficialStartTime = !!(config.raceOfficialStartTime && !isNaN(Date.parse(config.raceOfficialStartTime)));
  const officialStartTimestamp = hasOfficialStartTime ? Date.parse(config.raceOfficialStartTime!) : null;
  const timeToRaceStartMs = officialStartTimestamp && officialStartTimestamp > currentTimeForCalcs ? officialStartTimestamp - currentTimeForCalcs : 0;

  const raceElapsedTimeMs = state.raceStartTime && (state.isRaceActive || state.isRacePaused || state.raceCompleted)
    ? (state.raceCompleted && state.raceFinishTime ? state.raceFinishTime : currentTimeForCalcs) - state.raceStartTime - state.accumulatedPauseDuration
    : 0;

  const raceTimeRemainingMs = state.raceFinishTime && (state.isRaceActive || state.isRacePaused)
    ? Math.max(0, state.raceFinishTime - currentTimeForCalcs)
    : (state.raceCompleted ? 0 : config.raceDurationMinutes * 60 * 1000);

  // Stint Timers
  const stintElapsedTimeMs = state.stintStartTime && state.isRaceActive && !state.isRacePaused
    ? currentTimeForCalcs - state.stintStartTime
    // If paused, show time elapsed up to the pause point
    : (state.isRacePaused && state.stintStartTime && state.pauseTime ? state.pauseTime - state.stintStartTime : 0) ;


  // Fuel Timers & Progress
  const actualFuelTankDurationMinutes = config.fuelDurationMinutes; // Always use global
  const fuelElapsedTimeMs = state.fuelTankStartTime && state.isRaceActive && !state.isRacePaused
    ? currentTimeForCalcs - state.fuelTankStartTime
    // If paused, show fuel elapsed up to the pause point
    : (state.isRacePaused && state.fuelTankStartTime && state.pauseTime ? state.pauseTime - state.fuelTankStartTime : 0);

  const fuelTimeRemainingMs = Math.max(0, (actualFuelTankDurationMinutes * 60 * 1000) - fuelElapsedTimeMs);
  const fuelPercentage = Math.max(0, (fuelTimeRemainingMs / (actualFuelTankDurationMinutes * 60 * 1000)) * 100);

  // Current Driver & Stint Info
  const currentDriver = config.drivers.find(d => d.id === state.currentDriverId);
  const currentStintConfig = state.currentStintIndex < config.stintSequence.length ? config.stintSequence[state.currentStintIndex] : null;
  const currentStintPlannedDurationMinutes = currentStintConfig?.plannedDurationMinutes || config.fuelDurationMinutes; // Fallback to global fuel duration

  // Next Planned Driver Info (for swap dialog placeholder)
  const nextPlannedDriverIndex = state.currentStintIndex + 1;
  const nextPlannedStintEntry = nextPlannedDriverIndex < config.stintSequence.length ? config.stintSequence[nextPlannedDriverIndex] : null;
  const nextPlannedDriverId = nextPlannedStintEntry?.driverId || null;
  const nextStintOriginalPlannedDurationMinutes = nextPlannedDriverIndex < config.stintSequence.length ? config.stintSequence[nextPlannedDriverIndex]?.plannedDurationMinutes : undefined; // For dialog prefill


  // Conditional rendering flags
  const raceNotYetStartedAndHasFutureStartTime = timeToRaceStartMs > 0 && !state.isRaceActive && !state.raceCompleted;
  const canDisplayUpcomingStintsList = config.stintSequence.length > 0 && !state.raceCompleted; 
  const canDisplayCompletedStintsList = state.completedStints && state.completedStints.length > 0;
 
  // isLoading flags for TimerDisplay components
  const isLoadingRaceTimeRemaining = !state.isRaceActive && !state.isRacePaused && !state.raceCompleted && !raceNotYetStartedAndHasFutureStartTime && raceTimeRemainingMs === config.raceDurationMinutes * 60 * 1000;
  const isLoadingStintTime = (!state.isRaceActive && !state.isRacePaused && !state.raceCompleted && !state.stintStartTime) || raceNotYetStartedAndHasFutureStartTime;
  const isLoadingFuelTime = (!state.isRaceActive && !state.isRacePaused && !state.raceCompleted && !state.fuelTankStartTime) || raceNotYetStartedAndHasFutureStartTime;
  const isLoadingElapsedTime = !state.isRaceActive && !state.isRacePaused && !state.raceCompleted && raceElapsedTimeMs === 0 && !raceNotYetStartedAndHasFutureStartTime && !state.raceStartTime;


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
      
      {/* Current Status Card */}
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
              <p className="text-2xl font-semibold">{state.isRaceActive || state.raceCompleted ? (state.currentStintIndex + 1) : 'N/A'} / {config.stintSequence.length || 'N/A'}</p>
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
      
      {/* In-Race Action Buttons (Pause/Resume, Swap) */}
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
                disabled={state.isRacePaused || !state.currentDriverId || state.currentStintIndex >= config.stintSequence.length -1 && !config.stintSequence[state.currentStintIndex+1] /* Disable if on last stint or no next stint defined */}
                className="w-full"
            >
                <Users className="mr-2 h-5 w-5" /> Swap Driver
            </Button>
        </div>
      )}

      {/* Upcoming Stints Card */}
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
            <div> {/* Removed ScrollArea and max-h styling */}
              {(() => {
                  const upcomingStintsToRender = [];
                  let nextStintBaseTimeMs: number; // This will be the calculated start time of the *next* stint in the sequence

                  if (state.isRaceActive && state.stintStartTime !== null && !state.isRacePaused) {
                      // Race is active: base next stint's start on current time + remaining time of current stint
                      const currentStintConfigData = state.config.stintSequence[state.currentStintIndex];
                      const currentStintPlannedDurationMsForCalc = (currentStintConfigData?.plannedDurationMinutes || state.config.fuelDurationMinutes) * 60000;
                      const currentStintRemainingMs = Math.max(0, currentStintPlannedDurationMsForCalc - stintElapsedTimeMs);
                      nextStintBaseTimeMs = currentTimeForCalcs + currentStintRemainingMs;
                  } else if (state.isRacePaused && state.stintStartTime !== null && state.pauseTime !== null) {
                      // Race is paused: calculate based on official start + sum of planned durations up to current + accumulated pause
                      // OR based on current stint's original start + its planned duration + accumulated pause
                      if (officialStartTimestamp) {
                          nextStintBaseTimeMs = officialStartTimestamp;
                          for (let k=0; k <= state.currentStintIndex; k++) { 
                              const stint = state.config.stintSequence[k];
                              if (stint) { // Ensure stint exists
                                const stintDurationMs = (stint.plannedDurationMinutes || state.config.fuelDurationMinutes) * 60000;
                                nextStintBaseTimeMs += stintDurationMs;
                              }
                          }
                          nextStintBaseTimeMs += state.accumulatedPauseDuration; 
                      } else if (state.stintStartTime !== null) { // Base on current stint start if no official start
                           const currentStintData = state.config.stintSequence[state.currentStintIndex];
                           if (currentStintData) { // Ensure current stint data exists
                            const currentStintPlannedDurationMs = (currentStintData.plannedDurationMinutes || state.config.fuelDurationMinutes) * 60000;
                            nextStintBaseTimeMs = state.stintStartTime + currentStintPlannedDurationMs + state.accumulatedPauseDuration;
                           } else {
                            nextStintBaseTimeMs = 0; // Cannot calculate
                           }
                      } else {
                        nextStintBaseTimeMs = 0; // Cannot calculate
                      }
                  } else if ((hasOfficialStartTime || state.config.stintSequence.some(s => s.plannedDurationMinutes)) && !state.isRaceActive) {
                       // Race not started, but has official start time or planned durations: calculate from official start or now
                      nextStintBaseTimeMs = officialStartTimestamp || currentTimeForCalcs; // Base for the *first* stint
                      // If we are calculating from officialStartTimestamp, nextStintBaseTimeMs is the start of the *first* stint.
                      // If calculating from currentTimeForCalcs (no official start), it's also start of first.
                      // The loop below starts from the *first upcoming* (index 0 if not started)
                      // and `cumulativeDurationForUpcomingMs` will be 0 for the first displayed item.
                  } else {
                      nextStintBaseTimeMs = 0; // Cannot determine a base time for ETAs
                  }

                  let cumulativeDurationForUpcomingMs = 0; // For ETAs relative to nextStintBaseTimeMs

                  if (state.config) {
                      // Determine the starting index for displaying upcoming stints
                      // If race active/paused, start from currentStintIndex + 1
                      // If race not started, start from index 0
                      const startIndexForUpcoming = (state.isRaceActive || state.isRacePaused) ? state.currentStintIndex + 1 : 0;

                      for (let i = startIndexForUpcoming; i < state.config.stintSequence.length; i++) {
                        const stintEntry = state.config.stintSequence[i];
                        const driver = state.config.drivers.find(d => d.id === stintEntry.driverId);
                        const stintPlannedDurationMinutes = stintEntry.plannedDurationMinutes || state.config.fuelDurationMinutes;

                        let thisStintExpectedStartTimeMs: number | null = null;
                        let isPotentiallyTooLate = false;
                        let remainingRaceTimeAtSwapText: string | null = null;

                        if (nextStintBaseTimeMs !== 0) {
                            // If calculating for the very first stint from official start or current time (when race not active)
                            if (i === 0 && !(state.isRaceActive || state.isRacePaused)) {
                                thisStintExpectedStartTimeMs = nextStintBaseTimeMs; // First stint starts at base time
                            } else {
                                thisStintExpectedStartTimeMs = nextStintBaseTimeMs + cumulativeDurationForUpcomingMs;
                            }
                           
                            if (state.raceFinishTime && thisStintExpectedStartTimeMs >= state.raceFinishTime) {
                                isPotentiallyTooLate = true;
                            } else if (state.raceFinishTime) {
                                const remainingMs = state.raceFinishTime - thisStintExpectedStartTimeMs;
                                remainingRaceTimeAtSwapText = `Race time left: ${formatTime(remainingMs)}`;
                            }
                            // This cumulative duration is for the *next* stint in the list relative to the previous one
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
                                  // Disable if race paused OR if it's a past/current stint (cannot edit active/past stints from this list)
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
                                   // Disable if race paused OR if it's a past/current stint
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
                      {config.stintSequence.length === 0 ? "No stints planned." : ( (state.isRaceActive && state.currentStintIndex >= config.stintSequence.length -1 && config.stintSequence.length > 0) || state.raceCompleted ? "Final stint or all stints complete." : "No upcoming stints to display under current filter or race not started.")}
                    </p>;
                  }
                  return (
                      <>
                          <ul className="space-y-3">{upcomingStintsToRender}</ul>
                          {!state.raceCompleted && ( // Do not show "Add Stint" if race is over
                              <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={handleOpenAddStintDialog}
                                  className="mt-4 w-full"
                                  disabled={config.drivers.length === 0 || state.isRacePaused} // Also disable if paused
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

      {/* Completed Stints Card */}
      {canDisplayCompletedStintsList && (
        <Card className="shadow-lg mb-8">
          <CardHeader>
            <CardTitle className="text-xl font-semibold text-primary flex items-center">
              <History className="mr-2 h-5 w-5" /> Completed Stints
            </CardTitle>
          </CardHeader>
          <CardContent> {/* Removed ScrollArea */}
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
                {state.completedStints.slice().reverse().map((stint, index) => ( // Show newest first
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
     
      {/* Start/Reset Buttons (always at the bottom) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8">
        {!state.isRaceActive && !state.raceCompleted && (
          <Button
            onClick={handleStartRace}
            size="lg"
            className="w-full bg-primary hover:bg-primary/80 text-primary-foreground"
            // Disable if future start time is set AND current time is before it OR if race is paused (though it shouldn't be if not active)
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
          // Disable if race has a future start time and we are waiting for it (unless race also active/paused - edge case)
          disabled={raceNotYetStartedAndHasFutureStartTime && !state.isRaceActive && !state.isRacePaused && !state.raceCompleted}
        >
          <RotateCcw className="mr-2 h-5 w-5" /> Reset Race Data
        </Button>
      </div>

      {/* Dialogs */}
      <DriverSwapDialog
        isOpen={isDriverSwapDialogOpen}
        onClose={() => setDriverSwapDialogOpen(false)}
        onConfirm={handleSwapDriverConfirm}
        currentDriverId={state.currentDriverId}
        config={config} // Pass the current config from state
        nextPlannedDriverId={nextPlannedDriverId}
        nextStintOriginalPlannedDurationMinutes={nextStintOriginalPlannedDurationMinutes || config.fuelDurationMinutes}
      />
      {editingStintInfo && config && ( // Ensure config is not null when opening dialog
        <EditStintDialog
            isOpen={isEditStintDialogOpen}
            onClose={() => { setEditStintDialogOpen(false); setEditingStintInfo(null); }}
            onConfirm={handleEditStintConfirm}
            availableDrivers={config.drivers}
            initialDriverId={editingStintInfo.driverId}
            initialDuration={editingStintInfo.plannedDurationMinutes}
            defaultDuration={config.fuelDurationMinutes} // Pass global fuel duration as default
            isAdding={editingStintInfo.isAdding}
        />
      )}
    </div>
  );
}

