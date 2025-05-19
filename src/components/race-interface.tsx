
"use client";

import type { RaceConfiguration, CurrentRaceState, Driver, StintEntry, CompletedStintEntry } from '@/lib/types';
import { initialRaceState } from '@/lib/types';
import { useState, useEffect, useCallback, useReducer } from 'react';
import { useRouter } from 'next/navigation';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { RACE_CONFIG_LOCAL_STORAGE_KEY, LOW_FUEL_THRESHOLD_MINUTES } from '@/lib/config';
import { TimerDisplay, formatTime } from '@/components/timer-display';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription as UICardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { DriverSwapDialog } from '@/components/driver-swap-dialog';
import { EditStintDialog } from '@/components/edit-stint-dialog';
import { Progress } from "@/components/ui/progress";
import { Play, Pause, RotateCcw, Users, Fuel, Flag, AlertTriangle, TimerIcon, History, Clock, Pencil, PlusCircle } from 'lucide-react';
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
  | { type: 'RESET_RACE' }
  | { type: 'SWAP_DRIVER'; payload: { nextDriverId: string; refuel: boolean; nextStintPlannedDuration?: number } }
  | { type: 'TICK'; payload: { currentTime: number } }
  | { type: 'LOAD_CONFIG'; payload: RaceConfiguration }
  | { type: 'UPDATE_STINT_IN_SEQUENCE'; payload: { stintIndex: number; driverId: string; plannedDurationMinutes?: number } }
  | { type: 'ADD_STINT_TO_SEQUENCE'; payload: { driverId: string; plannedDurationMinutes?: number } };


function raceReducer(state: CurrentRaceState, action: RaceAction): CurrentRaceState {
  let config = state.config;
  const currentTime = action.type === 'TICK' ? action.payload.currentTime : Date.now();

  switch (action.type) {
    case 'LOAD_CONFIG':
      const shouldPreserveCompletedStints = !!state.config &&
                                            state.config.raceOfficialStartTime === action.payload.raceOfficialStartTime &&
                                            state.config.raceDurationMinutes === action.payload.raceDurationMinutes;

      return {
        ...initialRaceState,
        config: action.payload,
        currentDriverId: action.payload.stintSequence.length > 0 ? action.payload.stintSequence[0].driverId : null,
        completedStints: shouldPreserveCompletedStints ? (state.completedStints || []) : [],
      };
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
    case 'RESET_RACE':
      if (!config) return state;
      const configToResetWith = state.config || initialRaceState.config;
      if (!configToResetWith) return state;
      return {
        ...initialRaceState,
        config: configToResetWith,
        currentDriverId: configToResetWith.stintSequence[0]?.driverId || null,
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
        return { ...state, raceCompleted: true, isRaceActive: false, isRacePaused: false };
      }

      const currentStintConfigTick = state.config?.stintSequence[state.currentStintIndex];
      const fuelDurationForCurrentStintMinutes = currentStintConfigTick?.plannedDurationMinutes || state.config?.fuelDurationMinutes || 60;
      const fuelElapsedTimeMs = state.fuelTankStartTime ? currentTime - state.fuelTankStartTime : 0;
      const fuelDurationMs = fuelDurationForCurrentStintMinutes * 60 * 1000;
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

    default:
      return state;
  }
}


export function RaceInterface() {
  const router = useRouter();
  const { toast } = useToast();
  const [raceConfigFromStorage, setRaceConfigFromStorage] = useLocalStorage<RaceConfiguration | null>(RACE_CONFIG_LOCAL_STORAGE_KEY, null);
  const [state, dispatch] = useReducer(raceReducer, { ...initialRaceState, config: null, completedStints: [] });
  const [isDriverSwapDialogOpen, setDriverSwapDialogOpen] = useState(false);
  const [isEditStintDialogOpen, setEditStintDialogOpen] = useState(false);
  const [editingStintInfo, setEditingStintInfo] = useState<{ index: number; driverId: string; plannedDurationMinutes?: number; isAdding: boolean } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [currentClockTime, setCurrentClockTime] = useState(new Date());

 useEffect(() => {
    if (typeof raceConfigFromStorage === 'undefined') {
      setIsLoading(true); 
      return;
    }
    setIsLoading(false); 

    if (raceConfigFromStorage) {
       if (!state.config) { 
         dispatch({ type: 'LOAD_CONFIG', payload: raceConfigFromStorage });
       }
    } else {
      if (!state.isRaceActive && !state.config) { 
        toast({
          title: "Configuration Missing",
          description: "No race configuration found. Please set up the race first.",
          variant: "destructive",
        });
        router.push('/');
      }
    }
  }, [raceConfigFromStorage, router, toast, state.config, dispatch]); 

  useEffect(() => {
    const officialStartTimestampFromConfig = state.config?.raceOfficialStartTime ? Date.parse(state.config.raceOfficialStartTime) : null;
    let autoStartTimerId: NodeJS.Timeout | null = null;

    if (officialStartTimestampFromConfig && officialStartTimestampFromConfig > Date.now() && !state.isRaceActive && !state.raceCompleted && state.config) {
      const timeToAutoStart = officialStartTimestampFromConfig - Date.now();
      const currentConfigStartTime = state.config.raceOfficialStartTime; // Capture at time of effect setup

      autoStartTimerId = setTimeout(() => {
        // Re-check config inside timeout to ensure it hasn't changed due to other actions
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
  }, [state.isRaceActive, state.isRacePaused, state.raceCompleted, state.config?.raceOfficialStartTime, dispatch]);


  useEffect(() => {
    if (state.config && typeof raceConfigFromStorage !== 'undefined' && JSON.stringify(state.config) !== JSON.stringify(raceConfigFromStorage)) {
        setRaceConfigFromStorage(state.config);
    }
  }, [state.config, raceConfigFromStorage, setRaceConfigFromStorage]);

  const handleStartRace = () => dispatch({ type: 'START_RACE' });
  const handlePauseRace = () => dispatch({ type: 'PAUSE_RACE' });
  const handleResumeRace = () => dispatch({ type: 'RESUME_RACE' });
  const handleResetRace = () => {
     if (raceConfigFromStorage) {
        dispatch({ type: 'LOAD_CONFIG', payload: raceConfigFromStorage }); 
     } else if (state.config) { 
        dispatch({ type: 'RESET_RACE' }); 
     }
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


  if (isLoading || !state.config) {
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

  const raceElapsedTimeMs = state.raceStartTime && (state.isRaceActive || state.raceCompleted)
    ? (state.raceCompleted && state.raceFinishTime ? state.raceFinishTime : currentTimeForCalcs) - state.raceStartTime - state.accumulatedPauseDuration
    : 0;

  const raceTimeRemainingMs = state.raceFinishTime && (state.isRaceActive || state.isRacePaused)
    ? Math.max(0, state.raceFinishTime - currentTimeForCalcs)
    : (state.raceCompleted ? 0 : config.raceDurationMinutes * 60 * 1000);

  const stintElapsedTimeMs = state.stintStartTime && state.isRaceActive
    ? currentTimeForCalcs - state.stintStartTime
    : 0;

  const currentStintConfig = config.stintSequence[state.currentStintIndex];
  const fuelDurationForCurrentStintMinutes = currentStintConfig?.plannedDurationMinutes || config.fuelDurationMinutes;
  const fuelElapsedTimeMs = state.fuelTankStartTime && state.isRaceActive
    ? currentTimeForCalcs - state.fuelTankStartTime
    : 0;
  const fuelTimeRemainingMs = Math.max(0, (fuelDurationForCurrentStintMinutes * 60 * 1000) - fuelElapsedTimeMs);
  const fuelPercentage = Math.max(0, (fuelTimeRemainingMs / (fuelDurationForCurrentStintMinutes * 60 * 1000)) * 100);

  const currentDriver = config.drivers.find(d => d.id === state.currentDriverId);
  const nextPlannedDriverIndex = state.currentStintIndex + 1;
  const nextPlannedStintEntry = nextPlannedDriverIndex < config.stintSequence.length ? config.stintSequence[nextPlannedDriverIndex] : null;
  const nextPlannedDriverId = nextPlannedStintEntry?.driverId || null;
  const nextStintOriginalPlannedDurationMinutes = nextPlannedDriverIndex < config.stintSequence.length ? config.stintSequence[nextPlannedDriverIndex]?.plannedDurationMinutes : undefined;


  const raceNotYetStartedAndHasFutureStartTime = timeToRaceStartMs > 0 && !state.isRaceActive && !state.raceCompleted;
  const canDisplayUpcomingStintsList = config.stintSequence.length > 0 && state.currentStintIndex < config.stintSequence.length && !state.raceCompleted;
  const canDisplayCompletedStintsList = state.completedStints && state.completedStints.length > 0;

  const isLoadingRaceTimeRemaining = !state.isRaceActive && !state.raceCompleted && !raceNotYetStartedAndHasFutureStartTime && raceTimeRemainingMs === config.raceDurationMinutes * 60 * 1000;
  const isLoadingStintTime = !state.isRaceActive || raceNotYetStartedAndHasFutureStartTime;
  const isLoadingFuelTime = !state.isRaceActive || raceNotYetStartedAndHasFutureStartTime;
  const isLoadingElapsedTime = !state.isRaceActive && !state.raceCompleted && raceElapsedTimeMs === 0 && !raceNotYetStartedAndHasFutureStartTime;


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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
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
              <p className="text-2xl font-semibold">{state.currentStintIndex + 1} / {config.stintSequence.length}</p>
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
            <Label className="text-sm text-muted-foreground">Fuel Level ({fuelDurationForCurrentStintMinutes} min tank)</Label>
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
                {state.isRaceActive ? "Dynamically updated planned start times." : ((hasOfficialStartTime || state.config?.stintSequence.some(s => s.plannedDurationMinutes)) ? "Planned times based on official start or sequence durations." : "Sequence of drivers.")}
              </UICardDescription>
          </CardHeader>
          <CardContent>
            <div>
              {(() => {
                  const upcomingStintsToRender = [];
                  let nextStintBaseTimeMs: number;

                  if (state.isRaceActive && state.stintStartTime !== null && state.config) {
                      const currentStintData = state.config.stintSequence[state.currentStintIndex];
                      const currentStintPlannedDurationMs = (currentStintData?.plannedDurationMinutes || state.config.fuelDurationMinutes) * 60000;
                      nextStintBaseTimeMs = state.stintStartTime + currentStintPlannedDurationMs;
                  } else if ((hasOfficialStartTime || state.config?.stintSequence.some(s => s.plannedDurationMinutes)) && state.config) { // Use official start or sum of durations if official not set but durations are
                      nextStintBaseTimeMs = officialStartTimestamp || currentTimeForCalcs; // Fallback to current time if no official start for relative duration planning
                      if (!hasOfficialStartTime) { // If using current time, adjust base to be "now" + sum of completed stints from sequence
                          nextStintBaseTimeMs = currentTimeForCalcs;
                          for (let k = 0; k < state.currentStintIndex + 1; k++) {
                              if (state.completedStints[k]) { // If using actual completed stint data (not available pre-race like this)
                                // This branch is more for post-race analysis if we didn't have live updates
                                // For pre-race dynamic ETAs without official start, this 'else if' is tricky.
                                // The original logic for pre-race assumed official start. Let's refine.
                              } else if (k < state.config.stintSequence.length) {
                                // If officialStartTime isn't set, then baseTime is relative
                                // and we can only show durations, not specific ETAs.
                                // For simplicity, if no official start, ETAs won't be shown, only durations.
                                // The nextStintBaseTimeMs here becomes a flag for "can calculate ETA"
                              }
                          }
                      } else { // Has official start time
                        for (let k = 0; k <= state.currentStintIndex; k++) { 
                            if (k < state.config.stintSequence.length) {
                                // For pre-race, sum planned durations from official start
                                if (k === 0 && k === state.currentStintIndex) { // Special case for first stint if race not started
                                     nextStintBaseTimeMs = officialStartTimestamp!;
                                     const firstStintDurationMs = (state.config.stintSequence[0]?.plannedDurationMinutes || state.config.fuelDurationMinutes) * 60000;
                                     nextStintBaseTimeMs += firstStintDurationMs; // This is start time of 2nd stint
                                } else if (k < state.currentStintIndex) {
                                    const stintDurationMs = (state.config.stintSequence[k]?.plannedDurationMinutes || state.config.fuelDurationMinutes) * 60000;
                                     if (k===0) nextStintBaseTimeMs = officialStartTimestamp! + stintDurationMs; else nextStintBaseTimeMs += stintDurationMs;
                                } else if (k === state.currentStintIndex) { // current stint for ETA calculation
                                     const stintDurationMs = (state.config.stintSequence[k]?.plannedDurationMinutes || state.config.fuelDurationMinutes) * 60000;
                                     if (k===0 && officialStartTimestamp) nextStintBaseTimeMs = officialStartTimestamp + stintDurationMs;
                                     else if (k>0) nextStintBaseTimeMs += stintDurationMs;
                                     // This correctly sets nextStintBaseTimeMs to the END of the currentStintIndex (for pre-race)
                                }
                            }
                        }
                      }
                  } else {
                      nextStintBaseTimeMs = 0; // Cannot calculate ETAs
                  }

                  let cumulativeDurationForUpcomingMs = 0;

                  if (state.config) {
                      for (let i = state.currentStintIndex + 1; i < state.config.stintSequence.length; i++) {
                        const stintEntry = state.config.stintSequence[i];
                        const driver = state.config.drivers.find(d => d.id === stintEntry.driverId);
                        const stintPlannedDurationMinutes = stintEntry.plannedDurationMinutes || state.config.fuelDurationMinutes;

                        let thisStintExpectedStartTimeMs: number | null = null;
                        let isPotentiallyTooLate = false;

                        if (nextStintBaseTimeMs !== 0) { // Indicates ETAs can be calculated
                            thisStintExpectedStartTimeMs = nextStintBaseTimeMs + cumulativeDurationForUpcomingMs;
                            cumulativeDurationForUpcomingMs += stintPlannedDurationMinutes * 60000;

                            if (state.raceFinishTime && thisStintExpectedStartTimeMs >= state.raceFinishTime) {
                                isPotentiallyTooLate = true;
                            }
                        }
                        
                        upcomingStintsToRender.push(
                          <li key={`${stintEntry.driverId}-${i}`} className={`p-3 rounded-md border flex justify-between items-center bg-muted/30`}>
                            <div className="flex-grow">
                              <p className={`font-medium`}>{driver?.name || "N/A"}</p>
                              <p className="text-xs text-muted-foreground">
                                Stint #{i + 1} ({stintPlannedDurationMinutes} min)
                              </p>
                              {thisStintExpectedStartTimeMs !== null && nextStintBaseTimeMs !== 0 ? (
                                <p className={cn("text-xs font-semibold", isPotentiallyTooLate ? "text-destructive" : "text-primary")}>
                                  {isPotentiallyTooLate && <AlertTriangle className="inline-block h-3 w-3 mr-1 align-text-bottom" />}
                                  ETA: {new Date(thisStintExpectedStartTimeMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  {new Date(thisStintExpectedStartTimeMs).toLocaleDateString() !== new Date(currentTimeForCalcs).toLocaleDateString() &&
                                    ` (${new Date(thisStintExpectedStartTimeMs).toLocaleDateString([], {month: 'short', day: 'numeric'})})`}
                                  {isPotentiallyTooLate && " (After race finish)"}
                                </p>
                              ) : (
                                  <p className="text-xs text-muted-foreground">
                                    Planned Duration: {stintPlannedDurationMinutes} min
                                  </p>
                              )}
                            </div>
                            {!state.raceCompleted && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenEditStintDialog(i, stintEntry.driverId, stintEntry.plannedDurationMinutes)}
                                className="ml-2"
                                aria-label="Edit Stint"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                          </li>
                        );
                      }
                  }

                  if (upcomingStintsToRender.length === 0) {
                    return <p className="text-muted-foreground text-sm">
                      {config.stintSequence.length === 0 ? "No stints planned." : (state.currentStintIndex >= config.stintSequence.length -1 ? "Final stint or all stints complete." : "No upcoming stints.")}
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
                                  disabled={config.drivers.length === 0}
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
            disabled={raceNotYetStartedAndHasFutureStartTime}
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
                (state.isRaceActive || state.raceCompleted) && !(!state.isRaceActive && !state.raceCompleted) && "sm:col-span-2"
            )}
          disabled={raceNotYetStartedAndHasFutureStartTime && !state.isRaceActive && !state.isRacePaused}
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
