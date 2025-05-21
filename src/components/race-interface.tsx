"use client";

import type { RaceConfiguration, CurrentRaceState, Driver, StintEntry, CompletedStintEntry, Race } from '@/lib/types';
import { INITIAL_RACE_STATE, DEFAULT_RACE_CONFIG } from '@/lib/types';
import { useState, useEffect, useCallback, useReducer, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { RACE_CONFIG_LOCAL_STORAGE_KEY, RACE_STATE_LOCAL_STORAGE_KEY_FULL } from '@/lib/config';
import { TimerDisplay, formatTime } from '@/components/timer-display';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription as UICardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { DriverSwapDialog } from '@/components/driver-swap-dialog';
import { EditStintDialog } from '@/components/edit-stint-dialog';
import { Progress } from "@/components/ui/progress";
import { Play, Pause, RotateCcw, Users, Fuel, Flag, AlertTriangle, TimerIcon, History, Clock, Pencil, PlusCircle, Trash2, Briefcase, CheckCircle2, PauseCircle, PlayCircle, ArrowUp, ArrowDown, AlertCircle, ArrowLeft, Settings } from 'lucide-react';
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
import { EditStintTimeDialog } from '@/components/edit-stint-time-dialog';
import { PitStopDialog } from '@/components/pit-stop-dialog';
import { NavigationWarningDialog } from "@/components/navigation-warning-dialog";


type RaceAction =
  | { type: 'START_RACE' }
  | { type: 'PAUSE_RACE' }
  | { type: 'RESUME_RACE' }
  | { type: 'RESET_RACE_LOGIC' }
  | { type: 'SWAP_DRIVER'; payload: { nextDriverId: string; refuel: boolean; nextStintPlannedDuration?: number; fuelTime?: number } }
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
  | { type: 'REFUEL_DURING_PRACTICE'; payload: { fuelTime: number } }
  | { type: 'REFUEL_DURING_RACE'; payload: { fuelTime: number } }
  | { type: 'UPDATE_STINT_START_TIME'; payload: { newStartTime: number; timeDiff: number } }
  | { type: 'SET_RACE_START_TIME'; payload: string };


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
            fuelTankStartTime: (loadedState.fuelTankStartTime || 0) + offlinePracticePauseDuration, // Fuel timer also effectively pauses
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
          fuelAlertActive: fuelRemainingMs < (loadedState.config?.fuelWarningThresholdMinutes || 5) * 60 * 1000 && fuelRemainingMs > 0,
        };
      }
      if (loadedState.config && (!loadedState.config.practiceDurationMinutes || loadedState.config.practiceDurationMinutes <=0 ) ) {
        loadedState = { ...loadedState, practiceCompleted: true, isPracticePaused: false, practicePauseTime: null };
      }
      
      if (!loadedState.isRaceActive && !loadedState.isPracticeActive) { 
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
      // Preserve runtime state, only update config and config-dependent derived state
      let preservedState = { ...state, config: newConfig };

      if (state.raceStartTime && newConfig && state.config && newConfig.raceDurationMinutes !== state.config.raceDurationMinutes) {
        if (state.isRaceActive && !state.isRacePaused) {
            const durationDeltaMs = (newConfig.raceDurationMinutes - state.config.raceDurationMinutes) * 60 * 1000;
            preservedState.raceFinishTime = (state.raceFinishTime || (state.raceStartTime + state.config.raceDurationMinutes * 60 * 1000 + state.accumulatedPauseDuration)) + durationDeltaMs;
        } else if (state.isRaceActive && state.isRacePaused && state.pauseTime) {
            const elapsedBeforePause = state.pauseTime - state.raceStartTime - state.accumulatedPauseDuration;
            const remainingFromNewDuration = newConfig.raceDurationMinutes * 60000 - elapsedBeforePause;
            preservedState.raceFinishTime = state.pauseTime + remainingFromNewDuration;
        } else if (!state.isRaceActive && !state.raceCompleted && state.raceStartTime) { // Before race start, but start time exists
            const referenceStartTimeForDuration = newConfig.raceOfficialStartTime && Date.parse(newConfig.raceOfficialStartTime) <= state.raceStartTime
                                                ? Date.parse(newConfig.raceOfficialStartTime)
                                                : state.raceStartTime;
            preservedState.raceFinishTime = referenceStartTimeForDuration + newConfig.raceDurationMinutes * 60 * 1000 + state.accumulatedPauseDuration;
        }
      }

      // If the current driver/stint index is now invalid due to stint sequence changes
      if (preservedState.currentDriverId) {
          const driverExists = newConfig.drivers.some(d => d.id === preservedState.currentDriverId);
          const stintExists = preservedState.currentStintIndex < newConfig.stintSequence.length && 
                              newConfig.stintSequence[preservedState.currentStintIndex]?.driverId === preservedState.currentDriverId;
          if (!driverExists || !stintExists) {
              // Fallback if current driver/stint is no longer valid
              if (!state.isRaceActive && !state.isPracticeActive) {
                preservedState.currentDriverId = newConfig.stintSequence[0]?.driverId || (newConfig.drivers.length > 0 ? newConfig.drivers[0].id : null);
                preservedState.currentStintIndex = 0;
              } 
          }
      } else if (!state.isRaceActive && !state.isPracticeActive) { // If no current driver set and race not started
          preservedState.currentDriverId = newConfig.stintSequence[0]?.driverId || (newConfig.drivers.length > 0 ? newConfig.drivers[0].id : null);
          preservedState.currentStintIndex = 0;
      }
      
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
        if (state.config?.practiceDurationMinutes !== newConfig.practiceDurationMinutes && !preservedState.isPracticeActive && !preservedState.practiceCompleted) {
           preservedState = {
             ...preservedState,
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
        fuelTankStartTime: currentTime, 
        fuelAlertActive: false,
        currentDriverId: config.stintSequence[0]?.driverId || null, 
        currentStintIndex: 0,
        stintStartTime: currentTime, 
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
        fuelTankStartTime: (state.fuelTankStartTime || 0) + practicePauseDuration,
        stintStartTime: (state.stintStartTime || 0) + practicePauseDuration, 
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
    case 'RESET_PRACTICE': 
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
      if (!state.isPracticeActive || !config || state.isPracticePaused) { 
        return state;
      }
      return {
        ...state,
        fuelTankStartTime: action.payload.fuelTime, 
        fuelAlertActive: false,
      };
    case 'REFUEL_DURING_RACE':
      if (!state.isRaceActive || state.isRacePaused) return state;
      return {
        ...state,
        fuelTankStartTime: action.payload.fuelTime,
        fuelAlertActive: false,
      };
    case 'START_RACE':
      if (!config || state.isPracticeActive) return state; 
      const raceActualStartTime = currentTime;
      const officialStartTime = config.raceOfficialStartTime ? Date.parse(config.raceOfficialStartTime) : null;
      // Only use official start time if we're starting before or at the official start time
      const referenceStartTimeForDuration = officialStartTime && raceActualStartTime <= officialStartTime
                                            ? officialStartTime
                                            : raceActualStartTime;
      const raceFinishTime = referenceStartTimeForDuration + config.raceDurationMinutes * 60 * 1000;
      
      let newFuelTankStartTime = state.fuelTankStartTime;
      let newFuelAlertActive = state.fuelAlertActive;

      const carryOverFuelFromPractice = state.practiceCompleted && state.practiceStartTime !== null && state.fuelTankStartTime !== null && state.practiceFinishTime !== null;

      if (carryOverFuelFromPractice) {
        const fuelConsumedDuringPracticeMs = Math.max(0, state.practiceFinishTime! - state.fuelTankStartTime!);
        newFuelTankStartTime = raceActualStartTime - fuelConsumedDuringPracticeMs; 
        newFuelAlertActive = state.fuelAlertActive; 
      } else {
         newFuelTankStartTime = raceActualStartTime;
         newFuelAlertActive = false;
      }

      return {
        ...state,
        isRaceActive: true,
        isRacePaused: false,
        raceStartTime: referenceStartTimeForDuration,
        pauseTime: null,
        accumulatedPauseDuration: 0,
        currentStintIndex: 0, 
        currentDriverId: config.stintSequence[0]?.driverId || null,
        stintStartTime: raceActualStartTime,
        fuelTankStartTime: newFuelTankStartTime,
        fuelAlertActive: newFuelAlertActive,
        raceFinishTime,
        raceCompleted: false,
        completedStints: [], 
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
        ...INITIAL_RACE_STATE,
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

      const { nextDriverId, refuel, nextStintPlannedDuration, fuelTime } = action.payload;
      const currentDriver = config.drivers.find(d => d.id === state.currentDriverId);
      const originalStintConfig = config.stintSequence[state.currentStintIndex];
      const currentTime = Date.now();
      const effectiveSwapTime = fuelTime || currentTime;

      const completedStintEntry: CompletedStintEntry = {
        driverId: state.currentDriverId,
        driverName: currentDriver?.name || "N/A",
        stintNumber: state.currentStintIndex + 1,
        startTime: state.stintStartTime,
        endTime: effectiveSwapTime,
        actualDurationMs: effectiveSwapTime - state.stintStartTime,
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
        stintStartTime: effectiveSwapTime,
        fuelTankStartTime: refuel ? effectiveSwapTime : state.fuelTankStartTime,
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
      
      if (!newState.raceCompleted && config) {
          if (newState.isRaceActive && !newState.isRacePaused && newState.raceFinishTime && currentTime >= newState.raceFinishTime) {
            let finalCompletedStints = newState.completedStints;
            if (newState.currentDriverId && newState.stintStartTime !== null && newState.raceFinishTime) {
              const currentDriverForFinalStint = config.drivers.find(d => d.id === newState.currentDriverId);
              const currentStintDataForFinalStint = config.stintSequence[newState.currentStintIndex];
              const alreadyLogged = newState.completedStints.some(
                cs => cs.stintNumber === newState.currentStintIndex + 1 && cs.driverId === newState.currentDriverId && cs.endTime === newState.raceFinishTime
              );

              if (!alreadyLogged) {
                const finalStintEntry: CompletedStintEntry = {
                  driverId: newState.currentDriverId,
                  driverName: currentDriverForFinalStint?.name || "N/A",
                  stintNumber: newState.currentStintIndex + 1,
                  startTime: newState.stintStartTime,
                  endTime: newState.raceFinishTime, 
                  actualDurationMs: newState.raceFinishTime - newState.stintStartTime,
                  plannedDurationMinutes: currentStintDataForFinalStint?.plannedDurationMinutes,
                  refuelled: false, 
                };
                finalCompletedStints = [...newState.completedStints, finalStintEntry];
              }
            }
            newState = { ...newState, raceCompleted: true, isRaceActive: false, isRacePaused: false, completedStints: finalCompletedStints };
          }

          if (
            ((newState.isRaceActive && !newState.isRacePaused) || 
             (newState.isPracticeActive && !newState.isPracticePaused) || 
             (newState.practiceCompleted && !newState.isRaceActive && newState.fuelTankStartTime && newState.config && newState.practiceFinishTime)) 
          ) {
              const actualFuelTankDurationMinutesForTick = config.fuelDurationMinutes;
              let effectiveCurrentTimeForFuelTick = currentTime; 

              if (newState.practiceCompleted && !newState.isRaceActive && newState.practiceFinishTime && newState.fuelTankStartTime) {
                  effectiveCurrentTimeForFuelTick = newState.practiceFinishTime;
              }
              
              const fuelElapsedTimeMs_tick = newState.fuelTankStartTime ? effectiveCurrentTimeForFuelTick - newState.fuelTankStartTime : 0;
              const fuelDurationMs_tick = actualFuelTankDurationMinutesForTick * 60 * 1000;
              const fuelRemainingMs_tick = Math.max(0, fuelDurationMs_tick - fuelElapsedTimeMs_tick);
              const fuelAlert = fuelRemainingMs_tick < (newState.config?.fuelWarningThresholdMinutes || 5) * 60 * 1000 && fuelRemainingMs_tick > 0;
              
              if(newState.fuelAlertActive !== fuelAlert) { 
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
        return state; 
      }

      let newCurrentStintIndex = state.currentStintIndex;
      let newCurrentDriverId = state.currentDriverId;

      if (!state.isRaceActive && !state.isPracticeActive) {
        newCurrentDriverId = newStintSequence[0]?.driverId || null;
        newCurrentStintIndex = 0;
      } else if (state.isRaceActive && stintIndex < state.currentStintIndex) {
         newCurrentStintIndex = state.currentStintIndex -1;
      } else if (state.isRaceActive && stintIndex === state.currentStintIndex) {
        // If current active stint is deleted (UI should prevent this, but as fallback)
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
        return state; 
      }

      const [movedStint] = stintSequence.splice(oldIndex, 1);
      stintSequence.splice(newIndex, 0, movedStint);
      
      let newCurrentDriverId = state.currentDriverId;
      if (!state.isRaceActive && !state.isPracticeActive) {
        newCurrentDriverId = stintSequence[0]?.driverId || null;
      }

      return { ...state, config: { ...state.config, stintSequence }, currentDriverId: newCurrentDriverId };
    }

    case 'UPDATE_STINT_START_TIME': {
      if (!state.config) return state;
      const { newStartTime, timeDiff } = action.payload;
      let newState = {
        ...state,
        stintStartTime: newStartTime,
        fuelTankStartTime: state.fuelTankStartTime ? state.fuelTankStartTime + timeDiff : null,
      };

      // If this is the first stint, update race start time and finish time
      if (state.currentStintIndex === 0 && state.raceStartTime && state.raceFinishTime) {
        newState = {
          ...newState,
          raceStartTime: state.raceStartTime + timeDiff,
          raceFinishTime: state.raceFinishTime + timeDiff,
        };
      }

      return newState;
    }

    case 'SET_RACE_START_TIME': {
      return {
        ...state,
        raceStartTime: new Date(action.payload).getTime(),
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
    ...INITIAL_RACE_STATE,
    config: configToUse,
    currentDriverId: configToUse.stintSequence[0]?.driverId || null,
    completedStints: [],
    practiceCompleted: !(configToUse.practiceDurationMinutes && configToUse.practiceDurationMinutes > 0),
  };
};

const formatTimeRemaining = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

interface RaceInterfaceProps {
  race: Race;
  onBack: () => void;
  onSetup: () => void;
}

export function RaceInterface({ race, onBack, onSetup }: RaceInterfaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const [raceConfigFromStorage, setRaceConfigFromStorage] = useLocalStorage<RaceConfiguration | null>(RACE_CONFIG_LOCAL_STORAGE_KEY, null);
  const [showRaceTime, setShowRaceTime] = useState(false);
 
  const [state, dispatch] = useReducer(raceReducer, getInitialReducerState());
 
  const [isDriverSwapDialogOpen, setDriverSwapDialogOpen] = useState(false);
  const [isEditStintDialogOpen, setEditStintDialogOpen] = useState(false);
  const [editingStintInfo, setEditingStintInfo] = useState<{ index: number; driverId: string; plannedDurationMinutes?: number; isAdding: boolean } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [currentClockTime, setCurrentClockTime] = useState(new Date());
  const [isEditStintTimeDialogOpen, setEditStintTimeDialogOpen] = useState(false);
  const [isPitStopDialogOpen, setPitStopDialogOpen] = useState(false);
  const [isNavigationWarningOpen, setIsNavigationWarningOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);

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
        if (!state.config || JSON.stringify(raceConfigFromStorage) !== JSON.stringify(state.config)) {
            // toast({ title: "Configuration Updated", description: "Race settings have been updated." });
             dispatch({ type: 'LOAD_CONFIG', payload: raceConfigFromStorage });
        }
    } else if (state.config !== null) { 
        dispatch({ type: 'LOAD_CONFIG', payload: DEFAULT_RACE_CONFIG });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceConfigFromStorage, dispatch]); 
  
  useEffect(() => {
    if (typeof window !== 'undefined' && state.config && hasAttemptedInitialLoad.current) {
      const currentStoredConfigString = raceConfigFromStorage ? JSON.stringify(raceConfigFromStorage) : null;
      if (JSON.stringify(state.config) !== currentStoredConfigString) {
         setRaceConfigFromStorage(state.config); 
      }
    }
  }, [state.config, setRaceConfigFromStorage, raceConfigFromStorage]);
  
  useEffect(() => {
    const officialStartTimestampFromConfig = state.config?.raceOfficialStartTime ? Date.parse(state.config.raceOfficialStartTime) : null;

    const tickIntervalId = setInterval(() => {
      const currentTickTime = Date.now();
      setNow(currentTickTime); 
      setCurrentClockTime(new Date(currentTickTime)); 

      if ( ((state.isRaceActive && !state.isRacePaused) || (state.isPracticeActive && !state.isPracticePaused)) ||
           (state.practiceCompleted && !state.isRaceActive && state.fuelTankStartTime && state.config && state.practiceFinishTime) 
         ) {
        dispatch({ type: 'TICK', payload: { currentTime: currentTickTime } });
      }
    }, 100); 

    return () => {
      clearInterval(tickIntervalId);
    };
  }, [state.isRaceActive, state.isRacePaused, state.isPracticeActive, state.isPracticePaused, state.raceCompleted, state.practiceCompleted, state.fuelTankStartTime, state.config, state.practiceFinishTime, dispatch]);

  const handleStartPractice = () => dispatch({ type: 'START_PRACTICE' });
  const handlePausePractice = () => dispatch({ type: 'PAUSE_PRACTICE' });
  const handleResumePractice = () => dispatch({ type: 'RESUME_PRACTICE' });
  const handleCompletePractice = () => dispatch({ type: 'COMPLETE_PRACTICE' });
  const handleRefuelDuringPractice = () => {
    setPitStopDialogOpen(true);
  };
  const handlePitForFuel = () => {
    setPitStopDialogOpen(true);
  };

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

  const handleClearAllData = () => {
    if (window.confirm("Are you sure you want to clear all data? This will reset everything to default values and cannot be undone.")) {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(RACE_STATE_LOCAL_STORAGE_KEY_FULL);
        window.localStorage.removeItem(RACE_CONFIG_LOCAL_STORAGE_KEY);
      }
      // Create a truly empty config
      const emptyConfig: RaceConfiguration = {
        ...DEFAULT_RACE_CONFIG,
        drivers: [],
        stintSequence: [],
        raceDurationMinutes: 0,
        fuelDurationMinutes: 0,
        practiceDurationMinutes: 0,
        raceOfficialStartTime: undefined,
        driverCheckupMinutes: 30,
        fuelWarningThresholdMinutes: 5
      };
      dispatch({ type: 'LOAD_CONFIG', payload: emptyConfig });
      dispatch({ type: 'RESET_RACE_LOGIC' });
      setRaceConfigFromStorage(emptyConfig);
      toast({
        title: "All Data Cleared",
        description: "All race data has been reset to default values.",
        variant: "destructive"
      });
      handleNavigationAttempt(() => onSetup());
    }
  }

  const handleSwapDriverConfirm = (nextDriverId: string, refuel: boolean, nextStintPlannedDuration?: number, fuelTime?: number) => {
    dispatch({ 
      type: 'SWAP_DRIVER', 
      payload: { 
        nextDriverId, 
        refuel, 
        nextStintPlannedDuration,
        fuelTime 
      } 
    });

    toast({
      title: "Driver Swapped",
      description: `Switched to ${config.drivers.find(d => d.id === nextDriverId)?.name || "new driver"}`,
    });
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
  
  const handleMoveStint = (currentIndex: number, newIndex: number) => {
    if (!state.config || newIndex < 0 || newIndex >= state.config.stintSequence.length) {
      return; 
    }
    dispatch({ type: 'MOVE_STINT_IN_SEQUENCE', payload: { oldIndex: currentIndex, newIndex: newIndex } });
  };

  const handleDriverSwap = (nextDriverId: string, refuel: boolean, nextStintPlannedDuration?: number, fuelTime?: number) => {
    if (!state.currentDriverId || !state.stintStartTime) return;

    const currentTime = Date.now();
    dispatch({
      type: "SWAP_DRIVER",
      payload: {
        nextDriverId,
        refuel,
        nextStintPlannedDuration,
        fuelTime: fuelTime || currentTime,
      },
    });

    toast({
      title: "Driver Swapped",
      description: `Switched to ${config.drivers.find(d => d.id === nextDriverId)?.name || "new driver"}`,
    });
  };

  const handleEditStintTimeConfirm = (newStartTime: number) => {
    if (state.stintStartTime) {
      const timeDiff = newStartTime - state.stintStartTime;
      dispatch({
        type: 'UPDATE_STINT_START_TIME',
        payload: { newStartTime, timeDiff }
      });
      toast({
        title: "Start Time Updated",
        description: "The stint start time has been updated.",
      });
    }
  };

  const handleNavigationAttempt = (navigationCallback: () => void) => {
    if (state.isRaceActive || state.isPracticeActive) {
      setPendingNavigation(() => navigationCallback);
      setIsNavigationWarningOpen(true);
    } else {
      navigationCallback();
    }
  };

  const handleNavigationConfirm = () => {
    if (pendingNavigation) {
      pendingNavigation();
      setPendingNavigation(null);
    }
    setIsNavigationWarningOpen(false);
  };

  const handleNavigationCancel = () => {
    setPendingNavigation(null);
    setIsNavigationWarningOpen(false);
  };

  // Handle browser back navigation and swipe gestures
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (state.isRaceActive || state.isPracticeActive) {
        // Firefox requires both preventDefault and returnValue
        e.preventDefault();
        e.returnValue = 'You have an active race/practice session. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    const handlePopState = (e: PopStateEvent) => {
      if (state.isRaceActive || state.isPracticeActive) {
        e.preventDefault();
        // Push the current path back to history to prevent immediate navigation
        window.history.pushState(null, '', pathname);
        // Show our custom dialog
        setPendingNavigation(() => () => {
          // After confirmation, we need to go back twice to overcome the pushState
          router.back();
          router.back();
        });
        setIsNavigationWarningOpen(true);
      }
    };

    // Add an initial history entry to ensure we can catch the back navigation
    window.history.pushState(null, '', pathname);

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [state.isRaceActive, state.isPracticeActive, router, pathname]);

  if (isLoading || !state || !state.config) {
    return (
      <div className="container mx-auto py-8 text-center">
        <p className="text-xl text-muted-foreground">Loading Race Data...</p>
      </div>
    );
  }

  const { config } = state;

  // Show placeholder if no configuration is set up
  if (!config.drivers.length || !config.stintSequence.length) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="flex justify-between items-center mb-8">
          <Button
            variant="outline"
            onClick={() => handleNavigationAttempt(onBack)}
            className="flex items-center"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Race List
          </Button>
          <Button
            variant="outline"
            onClick={() => handleNavigationAttempt(() => onSetup())}
            className="flex items-center"
          >
            <Settings className="mr-2 h-4 w-4" />
            Setup
          </Button>
        </div>

        <Card className="max-w-2xl mx-auto text-center p-8">
          <CardHeader>
            <CardTitle className="text-2xl text-primary flex items-center justify-center">
              <Settings className="mr-2 h-8 w-8" /> No Race Configuration
            </CardTitle>
            <UICardDescription className="text-lg mt-4">
              Please set up your race configuration first.
            </UICardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-muted-foreground">
              You need to configure drivers and stint sequence before starting a race.
            </p>
            <Button
              onClick={() => handleNavigationAttempt(() => onSetup())}
              size="lg"
              className="w-full"
            >
              <Settings className="mr-2 h-5 w-5" /> Go to Setup
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  
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
    : (state.raceCompleted ? 0 : 
        (hasOfficialStartTime && officialStartTimestamp && officialStartTimestamp > currentTimeForCalcs)
          ? config.raceDurationMinutes * 60 * 1000
          : (state.raceStartTime ? Math.max(0, state.raceFinishTime! - currentTimeForCalcs) : config.raceDurationMinutes * 60 * 1000));
  
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
  let currentFuelElapsedTimeMs = 0;


  if (state.practiceCompleted && !state.isRaceActive && state.fuelTankStartTime && state.practiceFinishTime) {
    currentFuelElapsedTimeMs = state.practiceFinishTime - state.fuelTankStartTime;
    fuelTimeRemainingMs = Math.max(0, (actualFuelTankDurationMinutes * 60 * 1000) - currentFuelElapsedTimeMs);
    fuelPercentage = Math.max(0, (fuelTimeRemainingMs / (actualFuelTankDurationMinutes * 60 * 1000)) * 100);
  } else if (state.fuelTankStartTime) {
    let effectiveCurrentTimeForFuelCalc = currentTimeForCalcs;

    if (state.isPracticeActive && state.isPracticePaused && state.practicePauseTime) {
        effectiveCurrentTimeForFuelCalc = state.practicePauseTime;
    } else if (state.isRaceActive && state.isRacePaused && state.pauseTime) {
        effectiveCurrentTimeForFuelCalc = state.pauseTime;
    }
    
    currentFuelElapsedTimeMs = effectiveCurrentTimeForFuelCalc - state.fuelTankStartTime;
    fuelTimeRemainingMs = Math.max(0, (actualFuelTankDurationMinutes * 60 * 1000) - currentFuelElapsedTimeMs);
    fuelPercentage = Math.max(0, (fuelTimeRemainingMs / (actualFuelTankDurationMinutes * 60 * 1000)) * 100);

  } else if (!state.fuelTankStartTime && !state.isPracticeActive && !state.isRaceActive && !(timeToRaceStartMs > 0) && !(state.practiceCompleted && state.practiceFinishTime)) {
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


  const canDisplayCompletedStintsList = state.completedStints && state.completedStints.length > 0;
 
  const raceNotYetStartedAndHasFutureStartTime = timeToRaceStartMs > 0;
  const isLoadingRaceTimeRemaining = !state.isRaceActive && !state.isRacePaused && !state.raceCompleted && raceNotYetStartedAndHasFutureStartTime && raceTimeRemainingMs === config.raceDurationMinutes * 60 * 1000;
    
  let isLoadingStintTime = (!state.stintStartTime && !(state.isPracticeActive && state.stintStartTime !== null && !state.isPracticePaused) && !state.isRaceActive && !state.isRacePaused && !state.raceCompleted && !showPreRaceDriverInfo) || raceNotYetStartedAndHasFutureStartTime ;
  if (showPreRaceDriverInfo) isLoadingStintTime = false; 

  const isLoadingFuelTime = (!state.fuelTankStartTime && !(state.practiceCompleted && !state.isRaceActive && state.fuelTankStartTime !== null && state.practiceFinishTime)) && raceNotYetStartedAndHasFutureStartTime && !(state.isPracticeActive && state.fuelTankStartTime);


  const isLoadingElapsedTime = !state.isRaceActive && !state.isRacePaused && !state.raceCompleted && raceElapsedTimeMs === 0 && raceNotYetStartedAndHasFutureStartTime && !state.raceStartTime;
  const isLoadingPracticeTime = state.isPracticeActive && state.practiceStartTime === null;


  const showPracticeSection = config.practiceDurationMinutes && config.practiceDurationMinutes > 0 && !state.practiceCompleted && !state.isRaceActive && !state.raceCompleted;
  const canDisplayUpcomingStintsList = config.stintSequence.length > 0 && !state.raceCompleted && !state.isPracticeActive;

  const getExpectedStintTimes = (index: number) => {
    if (!state.raceStartTime) return null;

    const startTime = new Date(state.raceStartTime);
    let expectedStartTime: Date;

    if (state.raceStatus === 'setup') {
      // During setup, calculate from race start time
      expectedStartTime = new Date(startTime);
      for (let i = 0; i < index; i++) {
        expectedStartTime.setMinutes(
          expectedStartTime.getMinutes() + 
          (state.stintSequence[i].plannedDurationMinutes || 0)
        );
      }
    } else {
      // During race, use actual elapsed time
      expectedStartTime = new Date(startTime);
      expectedStartTime.setMinutes(expectedStartTime.getMinutes() + state.elapsedMinutes);
      for (let i = state.currentStintIndex + 1; i < index; i++) {
        expectedStartTime.setMinutes(
          expectedStartTime.getMinutes() + 
          (state.stintSequence[i].plannedDurationMinutes || 0)
        );
      }
    }

    const stint = state.stintSequence[index];
    if (!stint.plannedDurationMinutes) return { startTime: expectedStartTime, endTime: null };

    const expectedEndTime = new Date(expectedStartTime);
    expectedEndTime.setMinutes(
      expectedEndTime.getMinutes() + 
      stint.plannedDurationMinutes
    );

    return { startTime: expectedStartTime, endTime: expectedEndTime };
  };

  const handlePitStopConfirm = (fuelTime: number) => {
    if (state.isRaceActive) {
      dispatch({ type: 'REFUEL_DURING_RACE', payload: { fuelTime } });
    } else if (state.isPracticeActive) {
      dispatch({ type: 'REFUEL_DURING_PRACTICE', payload: { fuelTime } });
    }
    toast({
      title: "Refueled",
      description: "Fuel tank has been refilled to 100%.",
    });
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex justify-between items-center">
        <Button
          variant="outline"
          onClick={() => handleNavigationAttempt(onBack)}
          className="flex items-center"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Race List
        </Button>
        <Button
          variant="outline"
          onClick={() => handleNavigationAttempt(() => onSetup())}
          className="flex items-center"
        >
          <Settings className="mr-2 h-4 w-4" />
          Setup
        </Button>
      </div>

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
                 <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
                     <Button onClick={handleCompletePractice} variant="outline" size="sm" className="w-full" disabled={state.isPracticePaused}>
                       <CheckCircle2 className="mr-2 h-5 w-5" /> Complete Practice
                     </Button>
                 </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
      
      {!state.isPracticeActive && timeToRaceStartMs > 0 && (
        <Card className="mb-6 bg-accent/10 border-accent shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-2xl text-accent-foreground flex items-center">
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
          <div className="text-center p-4 rounded-lg shadow-md bg-card border">
            <div className="text-sm font-medium text-muted-foreground mb-1">Current Time</div>
            <div className="text-4xl font-mono font-bold tracking-wider text-foreground flex items-center justify-center">
              <Clock className="mr-2 h-7 w-7" />
              {currentClockTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
          </div>
        </CardContent>
      </Card>
      
      {state.fuelAlertActive && !state.raceCompleted && !((state.isPracticeActive && state.isPracticePaused) || (state.isRaceActive && state.isRacePaused) || (state.practiceCompleted && !state.isRaceActive)) && (
        <Alert variant="destructive" className="mb-4 bg-destructive/20 border-destructive">
          <AlertCircle className="h-4 w-4 text-destructive-foreground" />
          <AlertTitle className="text-destructive-foreground font-semibold">Fuel Warning</AlertTitle>
          <AlertDescription className="text-destructive-foreground">
            <div className="flex items-center gap-2">
              <span>Low fuel detected. Pit in</span>
              <span className="font-mono font-bold text-destructive-foreground bg-destructive/30 px-2 py-0.5 rounded">
                {formatTimeRemaining(Math.floor(fuelTimeRemainingMs / 1000))}
              </span>
              <span>to avoid running out of fuel.</span>
            </div>
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
                  className="font-bold"
              />
          </div>
          {state.stintStartTime && (state.isRaceActive || state.isPracticeActive) && !state.isRacePaused && !state.isPracticePaused && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Expected Stint End</p>
                <p className="text-xl font-medium">
                  {new Date(state.stintStartTime + currentStintPlannedDurationMinutes * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Race Time at Stint End</p>
                <p className="text-xl font-medium">
                  {formatTime(Math.max(0, raceTimeRemainingMs - (currentStintPlannedDurationMinutes * 60000 - stintElapsedTimeMs)))}
                </p>
              </div>
            </div>
          )}
          <div>
            <Label className="text-sm text-muted-foreground">Fuel Level ({actualFuelTankDurationMinutes} min tank)</Label>
            <Progress value={fuelPercentage} className={cn("w-full h-3 mt-1", 
                state.fuelAlertActive ? "[&>div]:bg-warning" : "[&>div]:bg-primary",
                ( (state.isPracticeActive && state.isPracticePaused) || 
                  (state.isRaceActive && state.isRacePaused) ||
                  (isLoadingFuelTime) ||
                  (state.practiceCompleted && !state.isRaceActive && !(state.fuelTankStartTime && state.practiceFinishTime))
                ) && "opacity-50"
            )} />
            <p className={cn("text-xs text-right mt-0.5", state.fuelAlertActive ? "text-warning-foreground" : "text-muted-foreground")}>{`${fuelPercentage.toFixed(0)}%`}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Stint Start Time</p>
            <div className="flex items-center gap-2">
              <p className="text-xl font-medium">
                {state.stintStartTime ? new Date(state.stintStartTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'}
              </p>
              {state.stintStartTime && (state.isRaceActive || state.isPracticeActive) && !state.isRacePaused && !state.isPracticePaused && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setEditStintTimeDialogOpen(true)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

       <div className="my-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {!state.isRaceActive && !state.raceCompleted && !state.isPracticeActive && (
                <Button
                    onClick={handleStartRace}
                    size="sm"
                    className="w-full bg-primary hover:bg-primary/80 text-primary-foreground"
                    disabled={
                        (timeToRaceStartMs > 0 && !(state.practiceCompleted || !config.practiceDurationMinutes)) ||
                        state.isRacePaused || 
                        state.isPracticeActive || 
                        state.isPracticePaused ||
                        (!state.practiceCompleted && !!config.practiceDurationMinutes && config.practiceDurationMinutes > 0)
                    }
                >
                    <Play className="mr-2 h-4 w-4" /> Start Race
                </Button>
            )}
            {state.isRaceActive && !state.isRacePaused && !state.raceCompleted && !state.isPracticeActive && (
                <Button onClick={handlePauseRace} variant="outline" size="sm" className="w-full">
                    <Pause className="mr-2 h-4 w-4" /> Pause Race
                </Button>
            )}
            {state.isRaceActive && state.isRacePaused && !state.raceCompleted && !state.isPracticeActive && (
                <Button onClick={handleResumeRace} size="sm" className="w-full bg-primary hover:bg-primary/80 text-primary-foreground">
                    <Play className="mr-2 h-4 w-4" /> Resume Race
                </Button>
            )}
            <Button
                onClick={() => setDriverSwapDialogOpen(true)}
                size="sm"
                variant="default"
                disabled={
                    state.isRacePaused || 
                    state.isPracticeActive || 
                    !state.currentDriverId || 
                    (state.currentStintIndex >= config.stintSequence.length -1 && !config.stintSequence[state.currentStintIndex+1]) ||
                    !state.isRaceActive
                }
                className="w-full"
            >
                <Users className="mr-2 h-4 w-4" /> Swap Driver
            </Button>
            {(state.isRaceActive || state.isPracticeActive) && !state.isRacePaused && !state.isPracticePaused && (
                <Button
                    onClick={handlePitForFuel}
                    size="sm"
                    variant="outline"
                    className="w-full"
                >
                    <Fuel className="mr-2 h-4 w-4" /> Pit for Fuel
                </Button>
            )}
        </div>
      
      {state.raceCompleted && (
         <Alert variant="default" className="mb-6 border-primary bg-primary/20">
          <Flag className="h-5 w-5 text-primary-foreground" />
          <AlertTitle className="font-semibold text-primary-foreground">Race Finished!</AlertTitle>
          <AlertDescription className="text-primary-foreground">
            The race has concluded. Total elapsed time: {formatTime(raceElapsedTimeMs)}.
          </AlertDescription>
        </Alert>
      )}

      {canDisplayCompletedStintsList && (
        <Card className="shadow-lg mb-8 mt-8 bg-card/50 border-border">
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
     
      {canDisplayUpcomingStintsList && (
        <Card className="shadow-lg mt-8 mb-6 bg-card/50 border-border">
          <CardHeader>
            <CardTitle className="text-xl font-semibold text-primary flex items-center">
              <Users className="mr-2 h-5 w-5" /> Upcoming Stints
            </CardTitle>
            <UICardDescription>
              List of planned upcoming stints. 
              {((state.isRacePaused && state.isRaceActive) || (state.isPracticePaused && state.isPracticeActive && !state.practiceCompleted)) && " (Paused - ETAs based on current progress)"}
            </UICardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {config.stintSequence.length > 0 ? (
              <div className="space-y-3 p-4"> 
                {config.stintSequence
                  .slice((state.isRaceActive || showPreRaceDriverInfo || (state.isPracticeActive && !state.practiceCompleted)) ? state.currentStintIndex : 0)
                  .map((stintEntry, relativeIndex) => {
                    const absoluteIndex = ((state.isRaceActive || showPreRaceDriverInfo || (state.isPracticeActive && !state.practiceCompleted)) ? state.currentStintIndex : 0) + relativeIndex;
                    const driver = config.drivers.find(d => d.id === stintEntry.driverId);
                    const currentStintPlannedDurationMinutes = (stintEntry.plannedDurationMinutes || config.fuelDurationMinutes);
                    const currentStintPlannedDurationMs = currentStintPlannedDurationMinutes * 60000;
                    
                    const isCurrentActiveStint = (state.isRaceActive || (state.isPracticeActive && !state.isPracticePaused)) && absoluteIndex === state.currentStintIndex;
                    const isCurrentStintForTimeline = isCurrentActiveStint || (showPreRaceDriverInfo && absoluteIndex === 0);

                    let nextStintBaseTimeMs: number;
                    if (state.isRaceActive && state.stintStartTime) {
                        nextStintBaseTimeMs = state.stintStartTime; 
                    } else if (state.isPracticeActive && !state.isPracticePaused && state.stintStartTime) {
                        nextStintBaseTimeMs = state.stintStartTime;
                    } else if (hasOfficialStartTime && officialStartTimestamp && officialStartTimestamp > 0) {
                        nextStintBaseTimeMs = officialStartTimestamp as number;
                    } else if (state.practiceCompleted && state.practiceFinishTime && !state.isRaceActive) {
                        nextStintBaseTimeMs = state.practiceFinishTime;
                    } else {
                        nextStintBaseTimeMs = currentTimeForCalcs;
                    }
                    
                    let cumulativeTimeOffsetMs = 0; 
                    const startIndexForUpcoming = (state.isRaceActive || showPreRaceDriverInfo || (state.isPracticeActive && !state.practiceCompleted)) ? state.currentStintIndex : 0;
                    
                    // Calculate cumulative FULL PLANNED durations of intervening stints
                    for (let i = startIndexForUpcoming; i < absoluteIndex; i++) {
                        const prevStintConfig = config.stintSequence[i];
                        const prevStintPlannedDurationMs = (prevStintConfig?.plannedDurationMinutes || config.fuelDurationMinutes) * 60000;
                        cumulativeTimeOffsetMs += prevStintPlannedDurationMs;
                    }
                     
                    let expectedStartTimeMs = nextStintBaseTimeMs + cumulativeTimeOffsetMs;
                    let expectedEndTimeMs = expectedStartTimeMs + currentStintPlannedDurationMs;
                    let effectiveStintDurationForBarMs = currentStintPlannedDurationMs;

                    // During race, adjust times based on race start and accumulated pause
                    if (state.isRaceActive && state.raceStartTime) {
                        // For current and future stints, calculate from race start
                        if (absoluteIndex >= state.currentStintIndex) {
                            const elapsedAtCurrentStint = state.stintStartTime ? state.stintStartTime - state.raceStartTime + state.accumulatedPauseDuration : 0;
                            expectedStartTimeMs = state.raceStartTime + elapsedAtCurrentStint + cumulativeTimeOffsetMs;
                            expectedEndTimeMs = expectedStartTimeMs + currentStintPlannedDurationMs;

                            // If this stint would end after race finish, adjust it to end at race finish
                            if (state.raceFinishTime && expectedEndTimeMs > state.raceFinishTime) {
                                expectedEndTimeMs = state.raceFinishTime;
                                // Update the effective duration for display
                                effectiveStintDurationForBarMs = expectedEndTimeMs - expectedStartTimeMs;
                            }
                        }
                    }

                    let raceTimeRemainingAtStintStartText: string | null = null;
                    let timeToStintStartMs: number | null = null;
                    let timeToStintEndMs: number | null = null;

                    const timelineBarTotalDurationMs = config.raceDurationMinutes * 60000;

                    const isPotentiallyTooLate = state.raceFinishTime && expectedStartTimeMs + currentStintPlannedDurationMs > state.raceFinishTime && expectedStartTimeMs < state.raceFinishTime;
                    const isCompletelyAfterFinish = state.raceFinishTime && expectedStartTimeMs >= state.raceFinishTime;

                    // Update expectedEndTimeMs to match race finish if stint would end after race finish
                    if (isPotentiallyTooLate && state.raceFinishTime) {
                        expectedEndTimeMs = state.raceFinishTime;
                        effectiveStintDurationForBarMs = expectedEndTimeMs - expectedStartTimeMs;
                    }

                    if (state.raceFinishTime && expectedStartTimeMs < state.raceFinishTime) {
                        if (state.raceStartTime) {
                            // Calculate elapsed race time at checkup point
                            const elapsedAtStart = expectedStartTimeMs - state.raceStartTime + state.accumulatedPauseDuration;
                            // Calculate remaining race time
                            const remainingTime = Math.max(0, state.raceFinishTime - state.raceStartTime - elapsedAtStart);
                            raceTimeRemainingAtStintStartText = `Race Time at Start: ${formatTime(remainingTime)}`;
                        } else {
                            raceTimeRemainingAtStintStartText = `Race Time at Start: ${formatTime(Math.max(0, state.raceFinishTime - expectedStartTimeMs))}`;
                        }
                    } else if (state.raceFinishTime && expectedStartTimeMs >= state.raceFinishTime) {
                        raceTimeRemainingAtStintStartText = "Starts after race finish";
                    }

                    let raceTimeAtEndText: string | null = null;
                    if (state.raceFinishTime && expectedEndTimeMs < state.raceFinishTime) {
                        if (state.raceStartTime) {
                            // Calculate elapsed race time at end point
                            const elapsedAtEnd = expectedEndTimeMs - state.raceStartTime + state.accumulatedPauseDuration;
                            // Calculate remaining race time
                            const remainingTime = Math.max(0, state.raceFinishTime - state.raceStartTime - elapsedAtEnd);
                            raceTimeAtEndText = `Race Time at End: ${formatTime(remainingTime)}`;
                        } else {
                            raceTimeAtEndText = `Race Time at End: ${formatTime(Math.max(0, state.raceFinishTime - expectedEndTimeMs))}`;
                        }
                    } else if (state.raceFinishTime && expectedEndTimeMs >= state.raceFinishTime) {
                        raceTimeAtEndText = "Ends after race finish";
                    }

                    let etaText: string | null = null;
                    let etaEndText: string | null = null;

                    if (!state.isPracticeActive && (officialStartTimestamp || state.raceStartTime || (state.practiceCompleted && state.practiceFinishTime))) {
                        etaText = `ETA Start: ${new Date(expectedStartTimeMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                        if (new Date(expectedStartTimeMs).toLocaleDateString() !== new Date(currentTimeForCalcs).toLocaleDateString()) {
                            etaText += ` (${new Date(expectedStartTimeMs).toLocaleDateString([], {month: 'short', day: 'numeric'})})`;
                        }
                        if (isCompletelyAfterFinish) {
                            etaText += " (After race finish)";
                        }
                        
                        etaEndText = `ETA End: ${new Date(expectedEndTimeMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                        if (isPotentiallyTooLate && !isCompletelyAfterFinish) {
                            etaEndText += ` (${formatTime(expectedEndTimeMs - state.raceFinishTime!)} past finish)`;
                        }
                        if (isCompletelyAfterFinish) {
                            etaEndText = "Ends after race finish";
                        }

                        if (expectedStartTimeMs > currentTimeForCalcs && !state.isRacePaused && !state.isPracticePaused) {
                            timeToStintStartMs = expectedStartTimeMs - currentTimeForCalcs;
                        }
                        if (expectedEndTimeMs > currentTimeForCalcs && !state.isRacePaused && !state.isPracticePaused) {
                            if(expectedStartTimeMs <= currentTimeForCalcs) { // Only show if stint has started or is current
                                timeToStintEndMs = expectedEndTimeMs - currentTimeForCalcs;
                            }
                        }
                    }
                    
                    let barStartOffsetFromRaceOriginMs: number;
                    let raceOriginTime = state.raceStartTime || officialStartTimestamp || 0;

                    if (isCurrentStintForTimeline && state.stintStartTime && (state.isRaceActive || state.isPracticeActive)) {
                        barStartOffsetFromRaceOriginMs = state.stintStartTime - raceOriginTime;
                    } else if (state.isRaceActive || officialStartTimestamp || (state.practiceCompleted && state.practiceFinishTime) ) {
                        barStartOffsetFromRaceOriginMs = expectedStartTimeMs - raceOriginTime;
                    } else { // Pre-race, no official start, not practice
                        let cumulativeDurationFromVirtualStart = 0;
                        for(let k=0; k < absoluteIndex; k++) {
                            cumulativeDurationFromVirtualStart += (config.stintSequence[k].plannedDurationMinutes || config.fuelDurationMinutes) * 60000;
                        }
                        barStartOffsetFromRaceOriginMs = cumulativeDurationFromVirtualStart;
                    }
                    barStartOffsetFromRaceOriginMs = Math.max(0, barStartOffsetFromRaceOriginMs);

                    let stintWidthPercent = timelineBarTotalDurationMs > 0 ? (effectiveStintDurationForBarMs / timelineBarTotalDurationMs) * 100 : 0;

                    const stintStartPercent = timelineBarTotalDurationMs > 0 ? (barStartOffsetFromRaceOriginMs / timelineBarTotalDurationMs) * 100 : 0;
                    const actualStintStartPercent = Math.max(0, stintStartPercent);
                    if (actualStintStartPercent >= 100) {
                        stintWidthPercent = 0; 
                    } else if (actualStintStartPercent + stintWidthPercent > 100) {
                        stintWidthPercent = Math.max(0, 100 - actualStintStartPercent);
                    }

                    let segmentColorClass = 'bg-primary';
                    if (isCurrentActiveStint) {
                        segmentColorClass = 'bg-primary/70'; 
                    }
                    if (isCompletelyAfterFinish) {
                        segmentColorClass = 'bg-accent'; 
                    } else if (isPotentiallyTooLate && effectiveStintDurationForBarMs > 0) {
                        segmentColorClass = 'bg-accent/70'; 
                    }
                    
                    const barTitle = `Planned: ${formatTime(barStartOffsetFromRaceOriginMs)} - ${formatTime(barStartOffsetFromRaceOriginMs + effectiveStintDurationForBarMs)} (Rel. to Race Plan Start)`;

                    return (
                      <div
                        key={`upcoming-stint-${absoluteIndex}`}
                        className={cn(
                          "p-4 rounded-lg border shadow-md text-sm",
                           (isCurrentActiveStint) ? "bg-primary/10 border-primary" : "bg-card",
                        )}
                      >
                        <div className="flex justify-between items-start">
                          <div className="space-y-1 flex-grow">
                            <p className="font-semibold text-base">
                              <span className="text-muted-foreground">#{absoluteIndex + 1} </span> 
                              {driver?.name || "N/A"}
                            </p>
                            <p>Planned Duration: {currentStintPlannedDurationMinutes} min
                                {effectiveStintDurationForBarMs !== currentStintPlannedDurationMs && state.raceFinishTime && expectedStartTimeMs < state.raceFinishTime &&
                                 ` (Effective: ${formatTime(effectiveStintDurationForBarMs)})`}
                            </p>
                            {etaText && <p className={cn("text-xs", isCompletelyAfterFinish && "text-accent-foreground", isPotentiallyTooLate && "text-accent-foreground")}>{etaText}</p>}
                            {etaEndText && <p className={cn("text-xs", (isPotentiallyTooLate || isCompletelyAfterFinish) && "text-accent-foreground")}>{etaEndText}</p>}
                            {raceTimeRemainingAtStintStartText && <p className={cn("text-xs", isCompletelyAfterFinish && "text-accent-foreground", isPotentiallyTooLate && "text-accent-foreground")}>{raceTimeRemainingAtStintStartText}</p>}
                            {raceTimeAtEndText && <p className={cn("text-xs", (isPotentiallyTooLate || isCompletelyAfterFinish) && "text-accent-foreground")}>{raceTimeAtEndText}</p>}

                            {timeToStintStartMs !== null && timeToStintStartMs > 0 && (
                                <p className="text-xs text-muted-foreground">
                                    <TimerIcon className="inline h-3 w-3 mr-1" />
                                    Starts in: {formatTime(timeToStintStartMs)}
                                </p>
                            )}
                             {timeToStintEndMs !== null && timeToStintEndMs > 0 && (
                                <p className="text-xs text-muted-foreground">
                                    <TimerIcon className="inline h-3 w-3 mr-1" />
                                    Ends in: {formatTime(timeToStintEndMs)}
                                </p>
                            )}

                            {/* Driver Checkup Times */}
                            {((state.isRaceActive || state.isPracticeActive || showPreRaceDriverInfo) && !state.raceCompleted && (config.driverCheckupMinutes ?? 0) > 0) && (
                              <div className="mt-2">
                                <div className="flex items-center justify-between mb-1">
                                  <p className="text-xs text-muted-foreground">Checkup Times:</p>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-xs"
                                    onClick={() => setShowRaceTime(!showRaceTime)}
                                  >
                                    {showRaceTime ? "Show Clock Time" : "Show Race Time Left"}
                                  </Button>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {(() => {
                                    const checkupInterval = stintEntry.checkupMinutes || config.driverCheckupMinutes;
                                    if (!checkupInterval || checkupInterval <= 0) return <></>;
                                    
                                    const checkupTimes: JSX.Element[] = [];
                                    let baseTime = expectedStartTimeMs;
                                    const stintEndTime = expectedEndTimeMs;
                                    
                                    while (baseTime < stintEndTime) {
                                      const checkupTime = baseTime + (checkupInterval * 60000);
                                      if (checkupTime <= stintEndTime) {
                                        let timeDisplay: string;
                                        if (showRaceTime && state.raceFinishTime) {
                                          if (state.raceStartTime) {
                                            // Calculate elapsed race time at checkup point
                                            const elapsedAtCheckup = checkupTime - state.raceStartTime + state.accumulatedPauseDuration;
                                            // Calculate remaining race time
                                            const remainingTime = Math.max(0, state.raceFinishTime - state.raceStartTime - elapsedAtCheckup);
                                            timeDisplay = formatTime(remainingTime);
                                          } else {
                                            // Race hasn't started yet, use official start time
                                            timeDisplay = formatTime(Math.max(0, state.raceFinishTime - checkupTime));
                                          }
                                        } else {
                                          timeDisplay = new Date(checkupTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                        }
                                        
                                        checkupTimes.push(
                                          <div 
                                            key={checkupTime} 
                                            className="px-2 py-1 bg-muted rounded text-xs flex items-center"
                                          >
                                            <TimerIcon className="h-3 w-3 mr-1" />
                                            {timeDisplay}
                                          </div>
                                        );
                                      }
                                      baseTime = checkupTime;
                                    }
                                    return checkupTimes.length > 0 ? checkupTimes : <></>;
                                  })()}
                                </div>
                              </div>
                            )}

                          </div>
                          {!state.raceCompleted && (
                            <div className="flex items-center space-x-1 shrink-0">
                               <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenEditStintDialog(absoluteIndex, stintEntry.driverId, stintEntry.plannedDurationMinutes)} disabled={ state.raceCompleted || (state.isRaceActive && state.isRacePaused) }><Pencil className="h-4 w-4" /></Button>
                               <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDeleteStint(absoluteIndex)} disabled={ state.raceCompleted || (state.isRaceActive && state.isRacePaused) || (isCurrentActiveStint) }><Trash2 className="h-4 w-4 text-destructive" /></Button>
                               <div className="flex flex-col">
                                <Button variant="ghost" size="icon" className="h-7 w-7 p-0 disabled:opacity-30" onClick={() => handleMoveStint(absoluteIndex, absoluteIndex - 1)} disabled={absoluteIndex === startIndexForUpcoming || absoluteIndex === 0 || state.raceCompleted || (state.isRaceActive && state.isRacePaused)}><ArrowUp className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 p-0 disabled:opacity-30" onClick={() => handleMoveStint(absoluteIndex, absoluteIndex + 1)} disabled={absoluteIndex === config.stintSequence.length - 1 || state.raceCompleted || (state.isRaceActive && state.isRacePaused)}><ArrowDown className="h-4 w-4" /></Button>
                               </div>
                            </div>
                          )}
                        </div>
                        {timelineBarTotalDurationMs > 0 && (
                            <div className="mt-3">
                                <div className="text-xs text-muted-foreground flex justify-between mb-0.5 px-0.5">
                                    <span>0:00</span>
                                    <span>{formatTime(timelineBarTotalDurationMs)}</span>
                                </div>
                                <div className="relative w-full h-3 bg-muted rounded">
                                    {stintWidthPercent > 0 && actualStintStartPercent < 100 && (
                                    <div
                                        className={cn(
                                            "absolute h-full rounded",
                                            segmentColorClass
                                        )}
                                        style={{
                                        left: `${actualStintStartPercent}%`,
                                        width: `${stintWidthPercent}%`,
                                        }}
                                        title={barTitle}
                                    />
                                    )}
                                    {isCurrentActiveStint && state.stintStartTime && timelineBarTotalDurationMs > 0 && stintElapsedTimeMs > 0 && (
                                       <div 
                                          className="absolute top-0 bottom-0 w-0.5 bg-destructive/70"
                                          style={{ left: `${actualStintStartPercent + (stintElapsedTimeMs / timelineBarTotalDurationMs) * 100}%`}}
                                          title="Current Stint Progress"
                                       />
                                    )}
                                </div>
                            </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm p-4 text-center">No upcoming stints planned or race sequence completed.</p>
            )}
            {!state.raceCompleted && config.drivers.length > 0 && !state.isPracticeActive && (
              <Button
                variant="outline"
                onClick={handleOpenAddStintDialog}
                className="w-full mt-4 mx-4 mb-4" // Added margin for spacing
                style={{maxWidth: 'calc(100% - 2rem)'}} // Ensure it respects card padding
                disabled={config.drivers.length === 0 || (state.isRaceActive && state.isRacePaused) || (state.isPracticeActive && !state.practiceCompleted)}
              >
                <PlusCircle className="mr-2 h-5 w-5" /> Add Stint to Sequence
              </Button>
            )}
            {!state.raceCompleted && config.drivers.length === 0 && !state.isPracticeActive && (
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

      <div className="mt-8 flex justify-center gap-4">
        <Button
          onClick={handleResetRace}
          variant="destructive"
          size="sm"
          className="w-48 bg-destructive/90 hover:bg-destructive text-destructive-foreground"
          disabled={
                  (timeToRaceStartMs > 0 && !state.isRaceActive && !state.isRacePaused && !state.raceCompleted && !state.isPracticeActive && !state.practiceCompleted && !state.isPracticePaused) ||
                  (state.isPracticeActive && !state.practiceCompleted && !state.isPracticePaused)
                  }
        >
          <RotateCcw className="mr-2 h-4 w-4" /> Reset Race Data
        </Button>
        <Button
          onClick={handleClearAllData}
          variant="destructive"
          size="sm"
          className="w-48 bg-destructive hover:bg-destructive/90 text-destructive-foreground"
        >
          <Trash2 className="mr-2 h-4 w-4" /> Clear All Data
        </Button>
      </div>

      {state.fuelWarning && (
        <Alert variant="destructive" className="mb-4 bg-destructive/20 border-destructive">
          <AlertCircle className="h-4 w-4 text-destructive-foreground" />
          <AlertTitle className="text-destructive-foreground font-semibold">Fuel Warning</AlertTitle>
          <AlertDescription className="text-destructive-foreground">
            <div className="flex items-center gap-2">
              <span>Low fuel detected. Pit in</span>
              <span className="font-mono font-bold text-destructive-foreground bg-destructive/30 px-2 py-0.5 rounded">
                {formatTimeRemaining(Math.floor(state.fuelWarningTimeRemaining || 0))}
              </span>
              <span>to avoid running out of fuel.</span>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {state.stintStartTime && (
        <EditStintTimeDialog
          isOpen={isEditStintTimeDialogOpen}
          onClose={() => setEditStintTimeDialogOpen(false)}
          onConfirm={handleEditStintTimeConfirm}
          currentStartTime={state.stintStartTime}
        />
      )}

      <PitStopDialog
        isOpen={isPitStopDialogOpen}
        onClose={() => setPitStopDialogOpen(false)}
        onConfirm={handlePitStopConfirm}
        currentTime={now}
      />

      <NavigationWarningDialog
        isOpen={isNavigationWarningOpen}
        onClose={handleNavigationCancel}
        onConfirm={handleNavigationConfirm}
        title="Active Session in Progress"
        description="You have an active race/practice session in progress. Navigating away will stop the current session and all data will be lost. Are you sure you want to continue?"
      />
    </div>
  );
}

