
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
import { Play, Pause, RotateCcw, Users, Fuel, Flag, AlertTriangle, TimerIcon, History, Clock, Pencil, PlusCircle, Trash2, Briefcase, CheckCircle2, PauseCircle, PlayCircle, ArrowUp, ArrowDown } from 'lucide-react'; // Removed GripVertical
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
  | { type: 'DELETE_STINT_FROM_SEQUENCE'; payload: { stintIndex: number } }
  | { type: 'MOVE_STINT_IN_SEQUENCE'; payload: { oldIndex: number; newIndex: number } }
  | { type: 'START_PRACTICE' }
  | { type: 'PAUSE_PRACTICE' }
  | { type: 'RESUME_PRACTICE' }
  | { type: 'COMPLETE_PRACTICE' }
  | { type: 'RESET_PRACTICE' }
  | { type: 'REFUEL_DURING_PRACTICE' };


function raceReducer(state: CurrentRaceState, action: RaceAction): CurrentRaceState {
  let config = state.config;
  const currentTime = action.type === 'TICK' ? action.payload.currentTime : Date.now();
  let newState = { ...state };


  switch (action.type) {
    case 'SET_FULL_STATE': {
      let loadedState = action.payload;
      // Handle race pause duration during offline
      if (loadedState.isRacePaused && loadedState.pauseTime) {
        const offlineRacePauseDuration = Math.max(0, currentTime - loadedState.pauseTime);
        loadedState = {
          ...loadedState,
          accumulatedPauseDuration: loadedState.accumulatedPauseDuration + offlineRacePauseDuration,
          pauseTime: currentTime, // Update pauseTime to now as if pause continued
          raceFinishTime: loadedState.raceFinishTime ? loadedState.raceFinishTime + offlineRacePauseDuration : null,
        };
      }
      // Handle practice pause duration during offline
      if (loadedState.isPracticeActive && loadedState.isPracticePaused && loadedState.practicePauseTime) {
        const offlinePracticePauseDuration = Math.max(0, currentTime - loadedState.practicePauseTime);
        loadedState = {
            ...loadedState,
            practiceStartTime: (loadedState.practiceStartTime || 0) + offlinePracticePauseDuration,
            fuelTankStartTime: (loadedState.fuelTankStartTime || 0) + offlinePracticePauseDuration,
            practiceFinishTime: loadedState.practiceFinishTime ? loadedState.practiceFinishTime + offlinePracticePauseDuration : null,
            practicePauseTime: currentTime, // Update practicePauseTime to now
            stintStartTime: loadedState.stintStartTime ? loadedState.stintStartTime + offlinePracticePauseDuration : null,
        };
      }

       if (loadedState.isPracticeActive && !loadedState.isPracticePaused && loadedState.practiceStartTime && loadedState.config?.practiceDurationMinutes) {
         const practiceElapsedTimeMs = currentTime - loadedState.practiceStartTime;
         const practiceDurationMs = loadedState.config.practiceDurationMinutes * 60 * 1000;
         if (practiceElapsedTimeMs >= practiceDurationMs) {
           // Practice timed out while offline
           const practiceActuallyFinishedAtLoad = loadedState.practiceStartTime + practiceDurationMs;
           loadedState = {
            ...loadedState,
            isPracticeActive: false,
            practiceCompleted: true,
            isPracticePaused: false,
            practicePauseTime: null,
            practiceFinishTime: practiceActuallyFinishedAtLoad,
            currentDriverId: loadedState.isRaceActive ? loadedState.currentDriverId : (loadedState.config?.stintSequence[0]?.driverId || null),
            currentStintIndex: loadedState.isRaceActive ? loadedState.currentStintIndex : 0,
            stintStartTime: loadedState.isRaceActive ? loadedState.stintStartTime : null,
           };
         } else {
           loadedState = { ...loadedState, practiceFinishTime: loadedState.practiceStartTime + practiceDurationMs };
         }
       }

      if (loadedState.config && loadedState.fuelTankStartTime) {
        let effectiveCurrentTimeForFuel = currentTime;
        if (loadedState.isPracticeActive && loadedState.isPracticePaused && loadedState.practicePauseTime) {
            effectiveCurrentTimeForFuel = loadedState.practicePauseTime;
        } else if (loadedState.isRaceActive && loadedState.isRacePaused && loadedState.pauseTime) {
            effectiveCurrentTimeForFuel = loadedState.pauseTime;
        } else if (loadedState.practiceCompleted && !loadedState.isRaceActive && loadedState.practiceFinishTime) {
             effectiveCurrentTimeForFuel = loadedState.practiceFinishTime;
        }

        const fuelElapsedTimeMs = effectiveCurrentTimeForFuel - loadedState.fuelTankStartTime;
        const fuelDurationMs = loadedState.config.fuelDurationMinutes * 60 * 1000;
        const fuelRemainingMs = Math.max(0, fuelDurationMs - fuelElapsedTimeMs);
        loadedState = {
          ...loadedState,
          fuelAlertActive: fuelRemainingMs < LOW_FUEL_THRESHOLD_MINUTES * 60 * 1000,
        };
      }
      if (loadedState.config && (!loadedState.config.practiceDurationMinutes || loadedState.config.practiceDurationMinutes <=0 ) ) {
        loadedState = { ...loadedState, practiceCompleted: true, isPracticePaused: false, practicePauseTime: null };
      }
      
      if (!loadedState.isRaceActive && !loadedState.isPracticeActive) { // if race and practice not active
        loadedState = {
          ...loadedState,
          currentDriverId: loadedState.config?.stintSequence[0]?.driverId || null,
          currentStintIndex: 0,
        };
      }

      return loadedState;
    }
   case 'LOAD_CONFIG': {
      const newConfig = action.payload;
      let preservedState = { ...state, config: newConfig };

      // Adjust raceFinishTime if race duration changed and race is active
      if (state.raceStartTime && newConfig && state.config && newConfig.raceDurationMinutes !== state.config.raceDurationMinutes && state.isRaceActive && !state.isRacePaused) {
          const durationDeltaMs = (newConfig.raceDurationMinutes - state.config.raceDurationMinutes) * 60 * 1000;
          preservedState.raceFinishTime = (state.raceFinishTime || (state.raceStartTime + state.config.raceDurationMinutes * 60 * 1000 + state.accumulatedPauseDuration)) + durationDeltaMs;
      } else if (newConfig && state.raceStartTime && state.isRaceActive && state.isRacePaused && state.pauseTime) {
           // If race is paused, recalculate based on pauseTime and new duration
           const elapsedBeforePause = state.pauseTime - state.raceStartTime - state.accumulatedPauseDuration;
           const remainingFromNewDuration = newConfig.raceDurationMinutes * 60000 - elapsedBeforePause;
           preservedState.raceFinishTime = state.pauseTime + remainingFromNewDuration;
      } else if (newConfig && state.raceStartTime && !state.isRaceActive && !state.raceCompleted) {
        // If race not active but was started (e.g. after reset), recalculate based on new duration
        const referenceStartTimeForDuration = newConfig.raceOfficialStartTime && Date.parse(newConfig.raceOfficialStartTime) <= state.raceStartTime
                                                ? Date.parse(newConfig.raceOfficialStartTime)
                                                : state.raceStartTime;
        preservedState.raceFinishTime = referenceStartTimeForDuration + newConfig.raceDurationMinutes * 60 * 1000 + state.accumulatedPauseDuration;
      }


      // If race is not active and not in practice, update currentDriverId to the new first driver
      if (!state.isRaceActive && !state.isPracticeActive) {
        preservedState.currentDriverId = newConfig.stintSequence[0]?.driverId || (newConfig.drivers.length > 0 ? newConfig.drivers[0].id : null);
        preservedState.currentStintIndex = 0;
      } else if (state.isRaceActive && state.currentStintIndex >= newConfig.stintSequence.length) {
        // Current stint index is out of bounds, possibly reset to last valid or handle gracefully
        preservedState.currentStintIndex = Math.max(0, newConfig.stintSequence.length - 1);
        preservedState.currentDriverId = newConfig.stintSequence[preservedState.currentStintIndex]?.driverId || null;
      }

      // Preserve practice state only if practice is configured in newConfig
      const isPracticeConfigured = newConfig.practiceDurationMinutes && newConfig.practiceDurationMinutes > 0;
      if (!isPracticeConfigured) {
        preservedState = {
          ...preservedState,
          isPracticeActive: false,
          practiceStartTime: null,
          practiceFinishTime: null,
          practiceCompleted: true,
          isPracticePaused: false,
          practicePauseTime: null,
        };
      } else {
        // If practice is configured, try to maintain current practice state,
        // unless practice duration fundamentally changed, then reset practice.
        if (state.config?.practiceDurationMinutes !== newConfig.practiceDurationMinutes) {
           preservedState = {
             ...preservedState,
             isPracticeActive: false,
             practiceStartTime: null,
             practiceFinishTime: null,
             practiceCompleted: false,
             isPracticePaused: false,
             practicePauseTime: null,
           }
        }
      }
      return preservedState;
    }
    case 'START_PRACTICE':
      if (!config || !config.practiceDurationMinutes || config.practiceDurationMinutes <= 0 || state.isPracticeActive || state.practiceCompleted || state.isRaceActive) {
        return state;
      }
      return {
        ...state,
        isPracticeActive: true,
        isPracticePaused: false,
        practicePauseTime: null,
        practiceCompleted: false,
        practiceStartTime: currentTime,
        practiceFinishTime: currentTime + config.practiceDurationMinutes * 60 * 1000,
        fuelTankStartTime: currentTime, // Fuel starts with practice
        fuelAlertActive: false,
        currentDriverId: config.stintSequence[0]?.driverId || null, // Practice uses first planned driver
        currentStintIndex: 0,
        stintStartTime: currentTime, // Stint timer starts for practice driver
      };
    case 'PAUSE_PRACTICE':
      if (!state.isPracticeActive || state.isPracticePaused) return state;
      return { ...state, isPracticePaused: true, practicePauseTime: currentTime };
    case 'RESUME_PRACTICE':
      if (!state.isPracticeActive || !state.isPracticePaused || !state.practicePauseTime) return state;
      const practicePauseDuration = currentTime - state.practicePauseTime;
      return {
        ...state,
        isPracticePaused: false,
        practicePauseTime: null,
        practiceStartTime: (state.practiceStartTime || 0) + practicePauseDuration,
        fuelTankStartTime: (state.fuelTankStartTime || 0) + practicePauseDuration, // Fuel timer also pauses
        stintStartTime: (state.stintStartTime || 0) + practicePauseDuration, // Stint timer also pauses
        practiceFinishTime: state.practiceFinishTime ? state.practiceFinishTime + practicePauseDuration : null,
      };
    case 'COMPLETE_PRACTICE':
      const practiceActuallyFinishedAt = state.practiceFinishTime && currentTime < state.practiceFinishTime ? currentTime : (state.practiceFinishTime || currentTime);
      return {
        ...state,
        isPracticeActive: false,
        isPracticePaused: false,
        practicePauseTime: null,
        practiceCompleted: true,
        practiceFinishTime: practiceActuallyFinishedAt,
        currentDriverId: state.isRaceActive ? state.currentDriverId : (config?.stintSequence[0]?.driverId || null),
        currentStintIndex: state.isRaceActive ? state.currentStintIndex : 0,
        stintStartTime: state.isRaceActive ? state.stintStartTime : null,
      };
    case 'RESET_PRACTICE': // Should be part of RESET_RACE_LOGIC or if practice config changes
       return {
        ...state,
        isPracticeActive: false,
        practiceStartTime: null,
        practiceFinishTime: null,
        practiceCompleted: !(config?.practiceDurationMinutes && config.practiceDurationMinutes > 0),
        isPracticePaused: false,
        practicePauseTime: null,
       }
    case 'REFUEL_DURING_PRACTICE':
      if (!state.isPracticeActive || !config || state.isPracticePaused) { // Cannot refuel if practice is paused
        return state;
      }
      return {
        ...state,
        fuelTankStartTime: currentTime, // Reset fuel tank start time
        fuelAlertActive: false,
      };
    case 'START_RACE':
      if (!config || state.isPracticeActive) return state; // Cannot start race if practice is active
      const raceActualStartTime = currentTime;
      const referenceStartTimeForDuration = config.raceOfficialStartTime && Date.parse(config.raceOfficialStartTime) <= raceActualStartTime
                                            ? Date.parse(config.raceOfficialStartTime)
                                            : raceActualStartTime;
      const raceFinishTime = referenceStartTimeForDuration + config.raceDurationMinutes * 60 * 1000;
      
      let newFuelTankStartTime = raceActualStartTime;
      let newFuelAlertActive = false;

      // Carry over fuel from practice if it was completed and active
      const carryOverFuelFromPractice = state.practiceCompleted && state.practiceStartTime !== null && state.fuelTankStartTime !== null && state.practiceFinishTime !== null;

      if (carryOverFuelFromPractice) {
        const fuelConsumedDuringPracticeMs = Math.max(0, state.practiceFinishTime! - state.fuelTankStartTime!);
        newFuelTankStartTime = raceActualStartTime - fuelConsumedDuringPracticeMs; // Adjust start time to reflect consumed fuel
        newFuelAlertActive = state.fuelAlertActive; // Carry over alert status
      } else {
         // If not carrying over, fuel starts fresh with the race
         newFuelTankStartTime = raceActualStartTime;
         newFuelAlertActive = false;
      }

      return {
        ...state,
        isRaceActive: true,
        isRacePaused: false,
        raceStartTime: raceActualStartTime,
        pauseTime: null,
        accumulatedPauseDuration: 0,
        currentStintIndex: 0, // Race always starts with the first stint in sequence
        currentDriverId: config.stintSequence[0]?.driverId || null,
        stintStartTime: raceActualStartTime,
        fuelTankStartTime: newFuelTankStartTime,
        fuelAlertActive: newFuelAlertActive,
        raceFinishTime,
        raceCompleted: false,
        completedStints: [], // Clear completed stints when a new race starts
      };
    case 'PAUSE_RACE':
      if (!state.isRaceActive || state.isRacePaused) return state;
      return { ...state, isRacePaused: true, pauseTime: currentTime };
    case 'RESUME_RACE':
      if (!state.isRaceActive || !state.isRacePaused || !state.pauseTime) return state;
      const pauseDuration = currentTime - state.pauseTime;
      const newAccumulatedPauseDuration = state.accumulatedPauseDuration + pauseDuration;
      return {
        ...state,
        isRacePaused: false,
        pauseTime: null,
        accumulatedPauseDuration: newAccumulatedPauseDuration,
        stintStartTime: (state.stintStartTime || 0) + pauseDuration,
        fuelTankStartTime: (state.fuelTankStartTime || 0) + pauseDuration,
        raceFinishTime: state.raceFinishTime ? state.raceFinishTime + pauseDuration : null,
      };
    case 'RESET_RACE_LOGIC':
      if (!config) return state;
      return {
        ...initialRaceState,
        config: config,
        currentDriverId: config.stintSequence[0]?.driverId || null,
        completedStints: [],
        isPracticeActive: false,
        practiceStartTime: null,
        practiceFinishTime: null,
        practiceCompleted: !(config.practiceDurationMinutes && config.practiceDurationMinutes > 0),
        isPracticePaused: false,
        practicePauseTime: null,
      };

    case 'SWAP_DRIVER': {
      if (!config || state.currentDriverId === null || state.stintStartTime === null || (!state.isRaceActive && !state.isPracticeActive) ) return state;

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
        fuelAlertActive: refuel ? false : state.fuelAlertActive,
      };
    }
    case 'TICK':
      if ((!state.isRaceActive && !state.isPracticeActive && !(state.practiceCompleted && state.fuelTankStartTime && config && state.practiceFinishTime)) || 
          (state.isRaceActive && state.isRacePaused) || 
          (state.isPracticeActive && state.isPracticePaused)) {
        return state;
      }

      newState = { ...state };

      // Handle practice completion by timer
      if (newState.isPracticeActive && !newState.isPracticePaused && newState.practiceFinishTime && config?.practiceDurationMinutes) {
        if (currentTime >= newState.practiceFinishTime) {
           const practiceActuallyFinishedAtTick = newState.practiceStartTime! + config.practiceDurationMinutes * 60000;
          newState = {
            ...newState,
            isPracticeActive: false,
            practiceCompleted: true,
            isPracticePaused: false,
            practicePauseTime: null,
            practiceFinishTime: practiceActuallyFinishedAtTick,
            currentDriverId: newState.isRaceActive ? newState.currentDriverId : (config?.stintSequence[0]?.driverId || null),
            currentStintIndex: newState.isRaceActive ? newState.currentStintIndex : 0,
            stintStartTime: newState.isRaceActive ? newState.stintStartTime : (newState.practiceCompleted ? null : newState.stintStartTime),
          };
        }
      }
      
      // Handle race completion by timer
      if (!newState.raceCompleted && config) {
          if (newState.isRaceActive && !newState.isRacePaused && newState.raceFinishTime && currentTime >= newState.raceFinishTime) {
            let finalCompletedStints = newState.completedStints;
            if (newState.currentDriverId && newState.stintStartTime !== null && newState.raceFinishTime) {
              const currentDriverForFinalStint = config.drivers.find(d => d.id === newState.currentDriverId);
              const currentStintDataForFinalStint = config.stintSequence[newState.currentStintIndex];
              // Check if this final stint wasn't already logged by a manual swap at the exact finish time
              const alreadyLogged = newState.completedStints.some(
                cs => cs.stintNumber === newState.currentStintIndex + 1 && cs.driverId === newState.currentDriverId && cs.endTime === newState.raceFinishTime
              );

              if (!alreadyLogged) {
                const finalStintEntry: CompletedStintEntry = {
                  driverId: newState.currentDriverId,
                  driverName: currentDriverForFinalStint?.name || "N/A",
                  stintNumber: newState.currentStintIndex + 1,
                  startTime: newState.stintStartTime,
                  endTime: newState.raceFinishTime, // Race finish time is the end time
                  actualDurationMs: newState.raceFinishTime - newState.stintStartTime,
                  plannedDurationMinutes: currentStintDataForFinalStint?.plannedDurationMinutes,
                  refuelled: false, // No refuel on race finish by timer
                };
                finalCompletedStints = [...newState.completedStints, finalStintEntry];
              }
            }
            newState = { ...newState, raceCompleted: true, isRaceActive: false, isRacePaused: false, completedStints: finalCompletedStints };
          }

          // Handle fuel alert logic
          if (
            ((newState.isRaceActive && !newState.isRacePaused) || // Race is active and running
             (newState.isPracticeActive && !newState.isPracticePaused) || // Practice is active and running
             (newState.practiceCompleted && !newState.isRaceActive && newState.fuelTankStartTime && newState.config && newState.practiceFinishTime)) // Practice completed, race not started, fuel carried over
          ) {
              const actualFuelTankDurationMinutesForTick = config.fuelDurationMinutes;
              let effectiveCurrentTimeForFuelTick = currentTime; 

              if (newState.practiceCompleted && !newState.isRaceActive && newState.practiceFinishTime && newState.fuelTankStartTime) {
                  // If practice just completed, calculate fuel based on when practice ended
                  effectiveCurrentTimeForFuelTick = newState.practiceFinishTime;
              }
              
              const fuelElapsedTimeMs_tick = newState.fuelTankStartTime ? effectiveCurrentTimeForFuelTick - newState.fuelTankStartTime : 0;
              const fuelDurationMs_tick = actualFuelTankDurationMinutesForTick * 60 * 1000;
              const fuelRemainingMs_tick = Math.max(0, fuelDurationMs_tick - fuelElapsedTimeMs_tick);
              const fuelAlert = fuelRemainingMs_tick < LOW_FUEL_THRESHOLD_MINUTES * 60 * 1000;
              
              if(newState.fuelAlertActive !== fuelAlert) { // Only update if alert status changes
                newState = { ...newState, fuelAlertActive: fuelAlert };
              }
          }
      }
      return newState;
   
    case 'UPDATE_STINT_IN_SEQUENCE': {
      if (!state.config) return state;
      const { stintIndex, driverId, plannedDurationMinutes } = action.payload;
      const newStintSequence = [...state.config.stintSequence];
      if (stintIndex >= 0 && stintIndex < newStintSequence.length) {
        newStintSequence[stintIndex] = { driverId, plannedDurationMinutes };
      }
      let newCurrentDriverId = state.currentDriverId;
      // If race not active/practice, and first stint changed, update current driver
      if (!state.isRaceActive && !state.isPracticeActive && stintIndex === 0) {
        newCurrentDriverId = driverId;
      }
      return { ...state, config: { ...state.config, stintSequence: newStintSequence }, currentDriverId: newCurrentDriverId };
    }

    case 'ADD_STINT_TO_SEQUENCE': {
      if (!state.config) return state;
      const { driverId, plannedDurationMinutes } = action.payload;
      const newStint: StintEntry = { driverId, plannedDurationMinutes };
      const newStintSequence = [...state.config.stintSequence, newStint];
      let newCurrentDriverId = state.currentDriverId;
      // If race not active/practice, and this is the first stint added, update current driver
      if (!state.isRaceActive && !state.isPracticeActive && newStintSequence.length === 1) {
        newCurrentDriverId = driverId;
      }
      return { ...state, config: { ...state.config, stintSequence: newStintSequence }, currentDriverId: newCurrentDriverId };
    }

    case 'DELETE_STINT_FROM_SEQUENCE': {
      if (!state.config) return state;
      const { stintIndex } = action.payload;
      
      const newStintSequence = [...state.config.stintSequence];
      if (stintIndex >= 0 && stintIndex < newStintSequence.length) {
        newStintSequence.splice(stintIndex, 1);
      } else {
        return state; // Invalid index
      }

      let newCurrentStintIndex = state.currentStintIndex;
      let newCurrentDriverId = state.currentDriverId;

      // If race is not active and not in practice:
      if (!state.isRaceActive && !state.isPracticeActive) {
        newCurrentDriverId = newStintSequence[0]?.driverId || null;
        newCurrentStintIndex = 0;
      } else if (state.isRaceActive && stintIndex <= state.currentStintIndex) {
        // This case should ideally be prevented by UI if deleting past/current active stint.
        // For now, let's assume UI disables delete for past/current if race active.
        // If it does happen, state could become inconsistent. For robustness, might reset or adjust.
        // For now, no change to currentDriverId or currentStintIndex if active race and deleting future.
      }
      return {
        ...state,
        config: { ...state.config, stintSequence: newStintSequence },
        currentStintIndex: newCurrentStintIndex,
        currentDriverId: newCurrentDriverId,
      };
    }
    case 'MOVE_STINT_IN_SEQUENCE': {
      if (!state.config) return state;
      const { oldIndex, newIndex } = action.payload;
      const stintSequence = [...state.config.stintSequence];

      if (oldIndex < 0 || oldIndex >= stintSequence.length || newIndex < 0 || newIndex >= stintSequence.length) {
        return state; // Invalid indices
      }

      const [movedStint] = stintSequence.splice(oldIndex, 1);
      stintSequence.splice(newIndex, 0, movedStint);
      
      let newCurrentDriverId = state.currentDriverId;
      // If race not active/practice, and first stint moved, update current driver
      if (!state.isRaceActive && !state.isPracticeActive) {
        newCurrentDriverId = stintSequence[0]?.driverId || null;
      }

      return { ...state, config: { ...state.config, stintSequence }, currentDriverId: newCurrentDriverId };
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
    practiceCompleted: !(configToUse.practiceDurationMinutes && configToUse.practiceDurationMinutes > 0),
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
      let fullStateLoaded = false;
      if (rawSavedState) {
        try {
          const parsedState: CurrentRaceState = JSON.parse(rawSavedState);
          if (parsedState && typeof parsedState.isRaceActive === 'boolean') {
             if (parsedState.config && Array.isArray(parsedState.config.drivers)) {
                dispatch({ type: 'SET_FULL_STATE', payload: parsedState });
                fullStateLoaded = true;
             } else {
                console.warn("Full race state from localStorage has malformed config. Trying to use config-only storage.");
             }
          } else {
            console.warn("Full race state from localStorage is malformed. Clearing it and attempting to load config only.");
            window.localStorage.removeItem(RACE_STATE_LOCAL_STORAGE_KEY_FULL);
          }
        } catch (e) {
          console.error("Failed to parse full race state from localStorage", e);
          window.localStorage.removeItem(RACE_STATE_LOCAL_STORAGE_KEY_FULL);
        }
      }
      
      if (!fullStateLoaded) {
          if (raceConfigFromStorage) {
            dispatch({ type: 'LOAD_CONFIG', payload: raceConfigFromStorage });
          } else {
            dispatch({ type: 'LOAD_CONFIG', payload: DEFAULT_RACE_CONFIG});
          }
      }
      hasAttemptedInitialLoad.current = true;
      setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && hasAttemptedInitialLoad.current && state && state.config) {
      window.localStorage.setItem(RACE_STATE_LOCAL_STORAGE_KEY_FULL, JSON.stringify(state));
    }
  }, [state]);

 useEffect(() => {
    if (typeof window === 'undefined' || !hasAttemptedInitialLoad.current || isLoading) {
      return;
    }

    if (raceConfigFromStorage) {
        // Only dispatch LOAD_CONFIG if the config from storage is meaningfully different
        // from what's already in state. This prevents loops from self-triggered saves.
        if (!state.config || JSON.stringify(raceConfigFromStorage) !== JSON.stringify(state.config)) {
             dispatch({ type: 'LOAD_CONFIG', payload: raceConfigFromStorage });
             // toast({ // Consider if this toast is too noisy, especially if internal config updates also trigger it
             //   title: "Configuration Updated",
             //   description: "Race settings have been updated.",
             // });
        }
    } else if (state.config !== null) { // If storage is cleared, reset to default
        dispatch({ type: 'LOAD_CONFIG', payload: DEFAULT_RACE_CONFIG });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceConfigFromStorage, dispatch]); 
  
  useEffect(() => {
    if (typeof window !== 'undefined' && state.config && hasAttemptedInitialLoad.current) {
      const currentStoredConfigString = raceConfigFromStorage ? JSON.stringify(raceConfigFromStorage) : null;
      if (JSON.stringify(state.config) !== currentStoredConfigString) {
         setRaceConfigFromStorage(state.config); // This syncs internal config changes (like edited stint durations) back to the setup page's view
      }
    }
  }, [state.config, setRaceConfigFromStorage, raceConfigFromStorage]);
  
  useEffect(() => {
    const officialStartTimestampFromConfig = state.config?.raceOfficialStartTime ? Date.parse(state.config.raceOfficialStartTime) : null;
    let autoStartTimerId: NodeJS.Timeout | null = null;

    if (officialStartTimestampFromConfig && officialStartTimestampFromConfig > Date.now() && !state.isRaceActive && !state.raceCompleted && state.config &&
        !state.isPracticeActive && (state.practiceCompleted || !state.config.practiceDurationMinutes) ) {
      const timeToAutoStart = officialStartTimestampFromConfig - Date.now();
      const currentConfigStartTime = state.config.raceOfficialStartTime;

      autoStartTimerId = setTimeout(() => {
        if (state.config?.raceOfficialStartTime === currentConfigStartTime &&
            Date.now() >= (officialStartTimestampFromConfig || 0) &&
            !state.isRaceActive && !state.raceCompleted &&
            !state.isPracticeActive && (state.practiceCompleted || !state.config.practiceDurationMinutes)
            ) {
           dispatch({ type: 'START_RACE' });
        }
      }, timeToAutoStart);
    }

    const tickIntervalId = setInterval(() => {
      const currentTickTime = Date.now();
      setNow(currentTickTime); // For general UI updates not tied to reducer
      setCurrentClockTime(new Date(currentTickTime)); // For the clock display

      // Dispatch TICK only if something active is happening or needs to be calculated by reducer
      if ( ((state.isRaceActive && !state.isRacePaused) || (state.isPracticeActive && !state.isPracticePaused)) ||
           (state.practiceCompleted && !state.isRaceActive && state.fuelTankStartTime && state.config && state.practiceFinishTime) 
         ) {
        dispatch({ type: 'TICK', payload: { currentTime: currentTickTime } });
      }
    }, 100); // Increased interval slightly, 100ms is still very frequent

    return () => {
      clearInterval(tickIntervalId);
      if (autoStartTimerId) clearInterval(autoStartTimerId);
    };
  }, [state.isRaceActive, state.isRacePaused, state.raceCompleted, state.config, state.isPracticeActive, state.practiceCompleted, state.isPracticePaused, state.fuelTankStartTime, state.practiceFinishTime, dispatch]);

  const handleStartPractice = () => dispatch({ type: 'START_PRACTICE' });
  const handlePausePractice = () => dispatch({ type: 'PAUSE_PRACTICE' });
  const handleResumePractice = () => dispatch({ type: 'RESUME_PRACTICE' });
  const handleCompletePractice = () => dispatch({ type: 'COMPLETE_PRACTICE' });
  const handleRefuelDuringPractice = () => dispatch({ type: 'REFUEL_DURING_PRACTICE' });

  const handleStartRace = () => dispatch({ type: 'START_RACE' });
  const handlePauseRace = () => dispatch({ type: 'PAUSE_RACE' });
  const handleResumeRace = () => dispatch({ type: 'RESUME_RACE' });
 
  const handleResetRace = () => {
     const configToResetWith = state.config || raceConfigFromStorage || DEFAULT_RACE_CONFIG;
     dispatch({ type: 'LOAD_CONFIG', payload: configToResetWith }); 
     dispatch({ type: 'RESET_RACE_LOGIC' }); 

     if (typeof window !== 'undefined') {
       window.localStorage.removeItem(RACE_STATE_LOCAL_STORAGE_KEY_FULL);
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
    // Confirmation can be handled here or in the component if preferred
    // For simplicity, directly dispatching. Consider adding a confirm dialog.
    if (window.confirm("Are you sure you want to delete this stint from the sequence? This cannot be undone.")) {
      dispatch({ type: 'DELETE_STINT_FROM_SEQUENCE', payload: { stintIndex: stintIndexInSequence } });
    }
  };
  
  const handleMoveStint = (oldIndex: number, newIndex: number) => {
    if (!state.config || newIndex < 0 || newIndex >= state.config.stintSequence.length) {
      return; 
    }
    dispatch({ type: 'MOVE_STINT_IN_SEQUENCE', payload: { oldIndex, newIndex } });
  };

  if (isLoading || !state || !state.config) {
    return (
      <div className="container mx-auto py-8 text-center">
        <p className="text-xl text-muted-foreground">Loading Race Data...</p>
      </div>
    );
  }

  const { config } = state;
  
  const hasOfficialStartTime = !!(config.raceOfficialStartTime && !isNaN(Date.parse(config.raceOfficialStartTime)));
  const officialStartTimestamp = hasOfficialStartTime ? Date.parse(config.raceOfficialStartTime!) : null;
  
  const currentTimeForCalcs = 
    (state.isRaceActive && state.isRacePaused && state.pauseTime) ? state.pauseTime :
    (state.isPracticeActive && state.isPracticePaused && state.practicePauseTime) ? state.practicePauseTime : 
    now;

  const timeToRaceStartMs = officialStartTimestamp && officialStartTimestamp > currentTimeForCalcs && !state.isRaceActive && !state.raceCompleted ? officialStartTimestamp - currentTimeForCalcs : 0;
  
  const raceElapsedTimeMs = state.raceStartTime && (state.isRaceActive || state.isRacePaused || state.raceCompleted)
    ? (state.raceCompleted && state.raceFinishTime ? state.raceFinishTime : currentTimeForCalcs) - state.raceStartTime - state.accumulatedPauseDuration
    : 0;

  const raceTimeRemainingMs = state.raceFinishTime && (state.isRaceActive || state.isRacePaused)
    ? Math.max(0, state.raceFinishTime - currentTimeForCalcs)
    : (state.raceCompleted ? 0 : config.raceDurationMinutes * 60 * 1000);
  
  const practiceTimeRemainingMs = state.isPracticeActive && !state.isPracticePaused && state.practiceFinishTime
    ? Math.max(0, state.practiceFinishTime - currentTimeForCalcs)
    : (state.isPracticeActive && state.isPracticePaused && state.practiceFinishTime && state.practicePauseTime
        ? Math.max(0, state.practiceFinishTime - state.practicePauseTime)
        : (state.isPracticeActive && config.practiceDurationMinutes ? config.practiceDurationMinutes * 60 * 1000 : 0)
      );

  let stintElapsedTimeMs = 0;
  if (state.stintStartTime) {
      if ((state.isRaceActive && !state.isRacePaused) || (state.isPracticeActive && state.stintStartTime !== null && !state.isPracticePaused)) {
          stintElapsedTimeMs = currentTimeForCalcs - state.stintStartTime;
      } else if (state.isRaceActive && state.isRacePaused && state.pauseTime) {
          stintElapsedTimeMs = state.pauseTime - state.stintStartTime;
      } else if (state.isPracticeActive && state.isPracticePaused && state.practicePauseTime) {
          stintElapsedTimeMs = state.practicePauseTime - state.stintStartTime;
      } else if (state.stintStartTime && !state.isPracticeActive && !state.isRaceActive && state.practiceCompleted) { 
          stintElapsedTimeMs = 0; 
      }
  }
  
  const actualFuelTankDurationMinutes = config.fuelDurationMinutes;
  let fuelTimeRemainingMs = 0;
  let fuelPercentage = 100;

  // This block calculates fuel based on various states
  if (state.practiceCompleted && !state.isRaceActive && state.fuelTankStartTime && state.practiceFinishTime) {
    // If practice just completed, use its finish time for fuel calculation.
    const fuelElapsedTimeAtPracticeEnd = state.practiceFinishTime - state.fuelTankStartTime;
    fuelTimeRemainingMs = Math.max(0, (actualFuelTankDurationMinutes * 60 * 1000) - fuelElapsedTimeAtPracticeEnd);
    fuelPercentage = Math.max(0, (fuelTimeRemainingMs / (actualFuelTankDurationMinutes * 60 * 1000)) * 100);
  } else if (state.fuelTankStartTime && (state.isPracticeActive || state.isRaceActive || state.isRacePaused)) { 
    // General case for active race/practice or paused states
    let effectiveCurrentTimeForFuelCalc = currentTimeForCalcs; 

    if (state.isPracticeActive && state.isPracticePaused && state.practicePauseTime) {
        effectiveCurrentTimeForFuelCalc = state.practicePauseTime;
    } else if (state.isRaceActive && state.isRacePaused && state.pauseTime) {
        effectiveCurrentTimeForFuelCalc = state.pauseTime;
    }
    
    const currentFuelElapsedTimeMs = effectiveCurrentTimeForFuelCalc - state.fuelTankStartTime;
    fuelTimeRemainingMs = Math.max(0, (actualFuelTankDurationMinutes * 60 * 1000) - currentFuelElapsedTimeMs);
    fuelPercentage = Math.max(0, (fuelTimeRemainingMs / (actualFuelTankDurationMinutes * 60 * 1000)) * 100);
  } else if (!state.fuelTankStartTime && !state.isPracticeActive && !state.isRaceActive && timeToRaceStartMs <= 0) {
     // Before anything has started (practice or race), and no future official start
     fuelTimeRemainingMs = actualFuelTankDurationMinutes * 60 * 1000;
     fuelPercentage = 100;
  }


  const currentDriver = config.drivers.find(d => d.id === state.currentDriverId);
  
  const showPreRaceDriverInfo = state.practiceCompleted && !state.isRaceActive && !state.raceCompleted && config.stintSequence.length > 0;
  const currentStintConfig = (state.isRaceActive || state.isPracticeActive || showPreRaceDriverInfo) && state.currentStintIndex < config.stintSequence.length 
                            ? config.stintSequence[state.currentStintIndex] 
                            : null;
  const currentStintPlannedDurationMinutes = currentStintConfig?.plannedDurationMinutes || config.fuelDurationMinutes;


  const nextPlannedDriverIndex = state.currentStintIndex + 1;
  const nextPlannedStintEntry = nextPlannedDriverIndex < config.stintSequence.length ? config.stintSequence[nextPlannedDriverIndex] : null;
  const nextPlannedDriverId = nextPlannedStintEntry?.driverId || null;
  const nextStintOriginalPlannedDurationMinutes = nextPlannedDriverIndex < config.stintSequence.length ? config.stintSequence[nextPlannedDriverIndex]?.plannedDurationMinutes : undefined;


  const canDisplayUpcomingStintsList = config.stintSequence.length > 0 && !state.raceCompleted;
  const canDisplayCompletedStintsList = state.completedStints && state.completedStints.length > 0;
 
  const isLoadingRaceTimeRemaining = !state.isRaceActive && !state.isRacePaused && !state.raceCompleted && timeToRaceStartMs <=0 && raceTimeRemainingMs === config.raceDurationMinutes * 60 * 1000;
    
  let isLoadingStintTime = (!state.stintStartTime && !(state.isPracticeActive && state.stintStartTime !== null && !state.isPracticePaused) && !state.isRaceActive && !state.isRacePaused && !state.raceCompleted && !showPreRaceDriverInfo) || timeToRaceStartMs > 0 ;
  if (showPreRaceDriverInfo) isLoadingStintTime = false; 

  const isLoadingFuelTime = (!state.fuelTankStartTime && !(state.practiceCompleted && !state.isRaceActive && state.fuelTankStartTime !== null && state.practiceFinishTime)) && timeToRaceStartMs > 0 && !(state.isPracticeActive && state.fuelTankStartTime);


  const isLoadingElapsedTime = !state.isRaceActive && !state.isRacePaused && !state.raceCompleted && raceElapsedTimeMs === 0 && timeToRaceStartMs <=0 && !state.raceStartTime;
  const isLoadingPracticeTime = state.isPracticeActive && state.practiceStartTime === null;


  const showPracticeSection = config.practiceDurationMinutes && config.practiceDurationMinutes > 0 && !state.practiceCompleted && !state.isRaceActive && !state.raceCompleted;

  const timelineTotalRaceDurationMs = config.raceDurationMinutes * 60000;


  return (
    <div className="container mx-auto py-8 px-4">
      {showPracticeSection && (
        <Card className="mb-6 bg-card border-border shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-2xl text-primary flex items-center">
              <Briefcase className="mr-2 h-7 w-7" /> Practice Session
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4 space-y-4">
            {!state.isPracticeActive ? (
              <Button onClick={handleStartPractice} size="lg" className="w-full bg-primary hover:bg-primary/80 text-primary-foreground">
                <Play className="mr-2 h-5 w-5" /> Start Practice ({config.practiceDurationMinutes} min)
              </Button>
            ) : (
              <>
                <TimerDisplay label="Practice Time Remaining" timeMs={practiceTimeRemainingMs} isLoading={isLoadingPracticeTime || state.isPracticePaused} />
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {!state.isPracticePaused ? (
                        <Button onClick={handlePausePractice} variant="outline" size="sm" className="w-full">
                            <PauseCircle className="mr-2 h-5 w-5" /> Pause Practice
                        </Button>
                    ) : (
                        <Button onClick={handleResumePractice} size="sm" className="w-full bg-primary hover:bg-primary/80 text-primary-foreground">
                            <PlayCircle className="mr-2 h-5 w-5" /> Resume Practice
                        </Button>
                    )}
                     <Button onClick={handleRefuelDuringPractice} variant="outline" size="sm" className="w-full" disabled={state.isPracticePaused}>
                        <Fuel className="mr-2 h-5 w-5" /> Pit to Refuel
                    </Button>
                 </div>
                 <Button onClick={handleCompletePractice} variant="outline" size="lg" className="w-full" disabled={state.isPracticePaused}>
                   <CheckCircle2 className="mr-2 h-5 w-5" /> Complete Practice Early
                 </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}
      
      {!state.isPracticeActive && timeToRaceStartMs > 0 && (
        <Card className="mb-6 bg-accent/10 border-accent shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-2xl text-accent flex items-center">
              <TimerIcon className="mr-2 h-7 w-7" /> Race Starts In
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <TimerDisplay label="" timeMs={timeToRaceStartMs} isLoading={false} variant="default" />
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
          <TimerDisplay label="Race Time Remaining" timeMs={raceTimeRemainingMs} isLoading={isLoadingRaceTimeRemaining || (state.isPracticeActive && !state.practiceCompleted)} />
          <TimerDisplay label="Elapsed Race Time" timeMs={raceElapsedTimeMs} isLoading={isLoadingElapsedTime || (state.isPracticeActive && !state.practiceCompleted)} />
           <div className="text-center p-4 rounded-lg shadow-md bg-card border">
            <div className="text-sm font-medium text-muted-foreground mb-1">Current Clock Time</div>
            <div className="text-4xl font-mono font-bold tracking-wider text-foreground flex items-center justify-center">
              <Clock className="mr-2 h-7 w-7" />
              {currentClockTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
          </div>
        </CardContent>
      </Card>
      
      <Card className="shadow-lg mb-6">
        <CardHeader>
            <CardTitle className="text-xl font-semibold text-primary">Current Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 items-baseline">
            <div>
              <p className="text-sm text-muted-foreground">Current Driver</p>
              <p className="text-2xl font-semibold text-primary">
                 {currentDriver?.name || "N/A"}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Next Planned Driver</p>
              <p className="text-xl font-medium">
                {state.currentStintIndex +1 >= config.stintSequence.length ? "End of sequence" : (config.drivers.find(d => d.id === config.stintSequence[state.currentStintIndex+1]?.driverId)?.name || "N/A")}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Stint</p>
              <p className="text-2xl font-semibold">
                {
                  (state.isPracticeActive || state.isRaceActive || state.raceCompleted || showPreRaceDriverInfo)
                  ? `${state.currentStintIndex + 1}`
                  : 'N/A'
                } / {config.stintSequence.length || 'N/A'}
              </p>
            </div>
             <div>
              <p className="text-sm text-muted-foreground">Planned Stint Duration</p>
              <p className="text-xl font-medium">
                 {
                   state.currentDriverId && config.stintSequence.length > 0 &&
                   (state.isRaceActive || state.isPracticeActive || state.raceCompleted || showPreRaceDriverInfo)
                   ? `${currentStintPlannedDurationMinutes} min`
                   : "N/A"
                 }
              </p>
            </div>
          </div>
         
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TimerDisplay 
                label="Current Driver Time" 
                timeMs={stintElapsedTimeMs} 
                isLoading={isLoadingStintTime || ((state.isPracticeActive && state.isPracticePaused) || (state.isRaceActive && state.isRacePaused))} 
              />
              <TimerDisplay
                  label="Fuel Time Remaining"
                  timeMs={fuelTimeRemainingMs}
                  variant={state.fuelAlertActive && !((state.isPracticeActive && state.isPracticePaused) || (state.isRaceActive && state.isRacePaused) || (state.practiceCompleted && !state.isRaceActive)) ? "warning" : "default"}
                  isLoading={isLoadingFuelTime || ((state.isPracticeActive && state.isPracticePaused) || (state.isRaceActive && state.isRacePaused))}
              />
          </div>
          <div>
            <Label className="text-sm text-muted-foreground">Fuel Level ({actualFuelTankDurationMinutes} min tank)</Label>
            <Progress value={fuelPercentage} className={cn("w-full h-3 mt-1", "[&>div]:bg-primary", 
                ( (state.isPracticeActive && state.isPracticePaused) || 
                  (state.isRaceActive && state.isRacePaused) ||
                  (isLoadingFuelTime) ||
                  (state.practiceCompleted && !state.isRaceActive && !(state.isPracticeActive && state.fuelTankStartTime))
                ) && "opacity-50"
            )} />
            <p className="text-xs text-right text-muted-foreground mt-0.5">{`${fuelPercentage.toFixed(0)}%`}</p>
          </div>
        </CardContent>
      </Card>
      
       {( (state.isRaceActive && !state.raceCompleted && !state.isPracticeActive) || (state.isPracticeActive && !state.isPracticePaused && !state.practiceCompleted) )&& (
         <div className="my-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {state.isRaceActive && !state.isRacePaused && (
                <Button onClick={handlePauseRace} variant="outline" size="lg" className="w-full">
                    <Pause className="mr-2 h-5 w-5" /> Pause Race
                </Button>
            )}
            {state.isRaceActive && state.isRacePaused && (
                <Button onClick={handleResumeRace} size="lg" className="w-full bg-primary hover:bg-primary/80 text-primary-foreground">
                    <Play className="mr-2 h-5 w-5" /> Resume Race
                </Button>
            )}
            <Button
                onClick={() => setDriverSwapDialogOpen(true)}
                size="lg"
                disabled={state.isRacePaused || state.isPracticeActive || !state.currentDriverId || (state.currentStintIndex >= config.stintSequence.length -1 && !config.stintSequence[state.currentStintIndex+1]) }
                className="w-full"
            >
                <Users className="mr-2 h-5 w-5" /> Swap Driver
            </Button>
        </div>
      )}

      {state.fuelAlertActive && !state.raceCompleted && !((state.isPracticeActive && state.isPracticePaused) || (state.isRaceActive && state.isRacePaused) || (state.practiceCompleted && !state.isRaceActive)) && (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <AlertTitle className="font-semibold text-destructive">Low Fuel Warning!</AlertTitle>
          <AlertDescription>
            Fuel is running low. Prepare for a pit stop.
          </AlertDescription>
        </Alert>
      )}

      {state.raceCompleted && (
         <Alert variant="default" className="mb-6 border-primary bg-primary/10">
          <Flag className="h-5 w-5 text-primary" />
          <AlertTitle className="font-semibold text-primary">Race Finished!</AlertTitle>
          <AlertDescription className="text-foreground">
            The race has concluded. Total elapsed time: {formatTime(raceElapsedTimeMs)}.
          </AlertDescription>
        </Alert>
      )}

      {canDisplayCompletedStintsList && !state.isPracticeActive && (
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
          {!state.isRaceActive && !state.raceCompleted && !state.isPracticeActive && (
          <Button
              onClick={handleStartRace}
              size="lg"
              className="w-full bg-primary hover:bg-primary/80 text-primary-foreground"
              disabled={
                  (timeToRaceStartMs > 0 && !(state.practiceCompleted || !config.practiceDurationMinutes)) ||
                  state.isRacePaused || 
                  state.isPracticeActive || 
                  state.isPracticePaused ||
                  (!state.practiceCompleted && !!config.practiceDurationMinutes && config.practiceDurationMinutes > 0)
              }
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
                  (!state.isRaceActive && !state.raceCompleted && !state.isPracticeActive) ? "sm:col-span-1" : "sm:col-span-2"
              )}
          disabled={
                  (timeToRaceStartMs > 0 && !state.isRaceActive && !state.isRacePaused && !state.raceCompleted && !state.isPracticeActive && !state.practiceCompleted && !state.isPracticePaused) ||
                  state.isPracticeActive || state.isPracticePaused
                  }
          >
          <RotateCcw className="mr-2 h-5 w-5" /> Reset Race Data
          </Button>
      </div>
      
      {/* Upcoming Stints Timeline - MOVED TO BOTTOM */}
      {canDisplayUpcomingStintsList && !state.isPracticeActive && (
        <Card className="shadow-lg mt-8 mb-6">
          <CardHeader>
            <CardTitle className="text-xl font-semibold text-primary flex items-center">
              <Users className="mr-2 h-5 w-5" /> Upcoming Stints Timeline
            </CardTitle>
            <UICardDescription>
              Visual representation of planned stints relative to total race duration.
              {((state.isRacePaused && state.isRaceActive) || (state.isPracticePaused && state.isPracticeActive && !state.practiceCompleted)) && " (Paused - Timeline based on planned durations)"}
            </UICardDescription>
          </CardHeader>
          <CardContent className="p-4">
            {config.stintSequence.length > 0 && state.currentStintIndex < config.stintSequence.length ? (
              <div className="relative w-full h-32 bg-muted rounded-lg overflow-hidden border border-border flex items-stretch">
                {/* Timeline Rail for Stints */}
                {(() => {
                  let cumulativeOffsetPercentage = 0;
                  const totalDisplayDurationMs = Math.max(timelineTotalRaceDurationMs, config.stintSequence.reduce((acc, s) => acc + (s.plannedDurationMinutes || config.fuelDurationMinutes) * 60000, 0));
                  const upcomingStints = config.stintSequence.slice(state.isRaceActive ? state.currentStintIndex : 0);

                  return upcomingStints.map((stintEntry, relativeIndex) => {
                    const absoluteIndex = (state.isRaceActive ? state.currentStintIndex : 0) + relativeIndex;
                    const driver = config.drivers.find(d => d.id === stintEntry.driverId);
                    const stintPlannedDurationMs = (stintEntry.plannedDurationMinutes || config.fuelDurationMinutes) * 60000;
                    const stintWidthPercentage = (stintPlannedDurationMs / totalDisplayDurationMs) * 100;
                    
                    const isCurrentStintForTimeline = state.isRaceActive && absoluteIndex === state.currentStintIndex;
                    
                    let etaText: string | null = null;
                    let remainingRaceTimeAtSwapText: string | null = null;
                    let isPotentiallyTooLate = false;
                    
                    if(absoluteIndex >= state.currentStintIndex || !state.isRaceActive) {
                      let expectedStartTimeMs : number | null = null;
                      let baseTime = state.raceStartTime;
                      let baseAccumulatedPause = state.accumulatedPauseDuration;

                      if(officialStartTimestamp && !state.isRaceActive && !state.raceCompleted){
                          baseTime = officialStartTimestamp;
                          baseAccumulatedPause = 0; // No pauses before official start
                      } else if (!baseTime && !officialStartTimestamp){ // Race not started, no official time
                          baseTime = currentTimeForCalcs; // Estimate from now
                          baseAccumulatedPause = 0;
                      }
                      
                      if (baseTime) {
                        expectedStartTimeMs = baseTime + baseAccumulatedPause;
                        for(let k = 0; k < absoluteIndex; k++) {
                            expectedStartTimeMs += (config.stintSequence[k].plannedDurationMinutes || config.fuelDurationMinutes) * 60000;
                        }
                        // If current stint is active and we are calculating for it, ETA is its actual start time
                        if (isCurrentStintForTimeline && state.stintStartTime) {
                           expectedStartTimeMs = state.stintStartTime;
                        } else if (state.isRaceActive && state.isRacePaused && state.pauseTime && absoluteIndex > state.currentStintIndex) {
                            // For future stints when race is paused, add current pause duration to ETA
                            expectedStartTimeMs += (currentTimeForCalcs - state.pauseTime);
                        }


                        etaText = `ETA: ${new Date(expectedStartTimeMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                        if (new Date(expectedStartTimeMs).toLocaleDateString() !== new Date(currentTimeForCalcs).toLocaleDateString()) {
                            etaText += ` (${new Date(expectedStartTimeMs).toLocaleDateString([], {month: 'short', day: 'numeric'})})`;
                        }
                        if (state.raceFinishTime && expectedStartTimeMs + stintPlannedDurationMs > state.raceFinishTime) { // Check if stint ENDS after race finish
                            isPotentiallyTooLate = true;
                            etaText += " (Ends past finish)";
                        } else if (state.raceFinishTime) {
                            const remainingMs = state.raceFinishTime - expectedStartTimeMs;
                            remainingRaceTimeAtSwapText = `Race time left at stint start: ${formatTime(remainingMs)}`;
                        }
                      }
                    }

                    const stintElement = (
                      <div
                        key={`timeline-stint-${absoluteIndex}`}
                        className={cn(
                          "h-full flex flex-col items-center justify-center text-xs text-center p-1 border-r border-background/50 last:border-r-0 cursor-pointer hover:opacity-80 transition-opacity relative group",
                          isCurrentStintForTimeline ? "bg-primary/80 text-primary-foreground" : "bg-primary/40 text-primary-foreground",
                           isPotentiallyTooLate && "bg-accent/60 !text-accent-foreground"
                        )}
                        style={{
                          width: `${stintWidthPercentage}%`,
                          minWidth: '80px', 
                        }}
                        title={`${driver?.name || 'N/A'} - ${stintEntry.plannedDurationMinutes || config.fuelDurationMinutes} min\n${etaText || ''}\n${remainingRaceTimeAtSwapText || ''}`}
                        onClick={() => !state.raceCompleted && !((state.isRaceActive && state.isRacePaused) || (state.isPracticeActive && !state.practiceCompleted)) && handleOpenEditStintDialog(absoluteIndex, stintEntry.driverId, stintEntry.plannedDurationMinutes)}
                      >
                        <p className="font-semibold truncate w-full">{driver?.name || "N/A"}</p>
                        <p className="text-xs">({stintEntry.plannedDurationMinutes || config.fuelDurationMinutes} min)</p>
                        {etaText && <p className={cn("text-[10px] mt-0.5", isPotentiallyTooLate && "font-bold")}>{etaText}</p>}
                         {remainingRaceTimeAtSwapText && !isPotentiallyTooLate && <p className="text-[10px]">{remainingRaceTimeAtSwapText}</p>}
                         {isPotentiallyTooLate && <AlertTriangle className="h-3 w-3 mx-auto mt-0.5" />}

                        {!state.raceCompleted && !((state.isRaceActive && state.isRacePaused) || (state.isPracticeActive && !state.practiceCompleted)) && (
                          <div className="absolute bottom-1 right-1 flex space-x-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                             <Button variant="ghost" size="sm" className="h-6 w-6 p-0 bg-card/50 hover:bg-card/70 text-card-foreground" onClick={(e) => { e.stopPropagation(); handleOpenEditStintDialog(absoluteIndex, stintEntry.driverId, stintEntry.plannedDurationMinutes);}}><Pencil className="h-3 w-3" /></Button>
                             <Button variant="ghost" size="sm" className="h-6 w-6 p-0 bg-card/50 hover:bg-card/70 text-destructive" onClick={(e) => { e.stopPropagation(); handleDeleteStint(absoluteIndex);}}><Trash2 className="h-3 w-3" /></Button>
                          </div>
                        )}
                      </div>
                    );
                    cumulativeOffsetPercentage += stintWidthPercentage;
                    return stintElement;
                  }).filter(Boolean); 
                })()}

                {/* Current Time Marker */}
                {state.isRaceActive && !state.isRacePaused && state.raceStartTime && totalDisplayDurationMs > 0 && (
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-destructive z-10"
                    style={{ left: `${(raceElapsedTimeMs / totalDisplayDurationMs) * 100}%` }}
                    title={`Current Race Time: ${formatTime(raceElapsedTimeMs)}`}
                  >
                    <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-destructive text-white text-[9px] px-1 rounded-sm shadow">NOW</div>
                  </div>
                )}
                 {/* Race Finish Line Marker based on configured race duration */}
                {totalDisplayDurationMs > 0 && config.raceDurationMinutes * 60000 <= totalDisplayDurationMs && (
                    <div
                        className="absolute top-0 bottom-0 w-px bg-foreground/70 z-5"
                        style={{ left: `${(config.raceDurationMinutes * 60000 / totalDisplayDurationMs) * 100}%` }}
                        title={`Planned Race Finish: ${formatTime(config.raceDurationMinutes * 60000)}`}
                    >
                         <Flag className="absolute -top-2.5 right-0.5 h-4 w-4 text-foreground/80 transform -translate-x-1/2"/>
                    </div>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm p-4">No stints planned.</p>
            )}
            {!state.raceCompleted && config.drivers.length > 0 && (
              <Button
                variant="outline"
                onClick={handleOpenAddStintDialog}
                className="w-full mt-4"
                disabled={config.drivers.length === 0 || (state.isRaceActive && state.isRacePaused) || (state.isPracticeActive && !state.practiceCompleted)}
              >
                <PlusCircle className="mr-2 h-5 w-5" /> Add Stint to Timeline
              </Button>
            )}
            {!state.raceCompleted && config.drivers.length === 0 && (
              <div className="p-3 text-center text-muted-foreground mt-4">
                <Users className="h-10 w-10 mb-2 mx-auto"/>
                <span className="text-sm">Add drivers in Setup to plan more stints.</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}


      <DriverSwapDialog
        isOpen={isDriverSwapDialogOpen}
        onClose={() => setDriverSwapDialogOpen(false)}
        onConfirm={handleSwapDriverConfirm}
        currentDriverId={state.currentDriverId}
        config={config}
        nextPlannedDriverId={nextPlannedDriverId}
        nextStintOriginalPlannedDurationMinutes={nextStintOriginalPlannedDurationMinutes || config.fuelDurationMinutes}
      />
      {editingStintInfo && config && (
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


    