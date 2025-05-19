
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
import { Progress } from "@/components/ui/progress";
import { Play, Pause, RotateCcw, Users, Fuel, Flag, AlertTriangle, TimerIcon, History } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";


type RaceAction =
  | { type: 'START_RACE' }
  | { type: 'PAUSE_RACE' }
  | { type: 'RESUME_RACE' }
  | { type: 'RESET_RACE' }
  | { type: 'SWAP_DRIVER'; payload: { nextDriverId: string; refuel: boolean; nextStintPlannedDuration?: number } }
  | { type: 'TICK'; payload: { currentTime: number } }
  | { type: 'LOAD_CONFIG'; payload: RaceConfiguration };


function raceReducer(state: CurrentRaceState, action: RaceAction): CurrentRaceState {
  let config = state.config;
  const currentTime = action.type === 'TICK' ? action.payload.currentTime : Date.now();

  switch (action.type) {
    case 'LOAD_CONFIG':
      // Only reset completedStints if it's a true initial load (no existing config)
      // or if the incoming config is fundamentally different (e.g. different race duration - not easily comparable here though)
      // For simplicity, if state.config exists, we preserve completedStints unless it's a full reset.
      const shouldPreserveCompletedStints = !!state.config;

      return {
        ...initialRaceState,
        config: action.payload,
        currentDriverId: action.payload.stintSequence.length > 0 ? action.payload.stintSequence[0].driverId : null,
        completedStints: shouldPreserveCompletedStints && state.completedStints ? state.completedStints : [],
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
        completedStints: [], // Reset completed stints on new race start
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
        config: configToResetWith, // Keep the original config from storage/initial
        currentDriverId: configToResetWith.stintSequence[0]?.driverId || null,
        completedStints: [] // Clear completed stints on reset
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
        config: updatedConfig, // Persist the potentially updated config
        currentStintIndex: state.currentStintIndex + 1,
        currentDriverId: nextDriverId,
        stintStartTime: currentTime,
        fuelTankStartTime: refuel ? currentTime : state.fuelTankStartTime,
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
  const [isLoading, setIsLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

 useEffect(() => {
    if (typeof raceConfigFromStorage === 'undefined') {
      setIsLoading(true);
      return;
    }
    setIsLoading(false);

    if (raceConfigFromStorage) {
      // Only dispatch LOAD_CONFIG if state.config is null (initial page load).
      // This avoids wiping runtime state like completedStints when config is saved back to localStorage.
      if (!state.config) { 
        dispatch({ type: 'LOAD_CONFIG', payload: raceConfigFromStorage });
      }
      // If state.config exists but is different from storage (e.g., due to an external change or initial load sync),
      // we might want a more nuanced update strategy, but for now, LOAD_CONFIG on initial null state is safer.
      // A deep comparison could be added here if needed: JSON.stringify(state.config) !== JSON.stringify(raceConfigFromStorage)
      // and then decide if a LOAD_CONFIG is truly necessary or if only raceConfigFromStorage should be updated.
    } else {
      if (!state.isRaceActive) { // Prevent redirection during an active race if storage clears
        toast({
          title: "Configuration Missing",
          description: "No race configuration found. Please set up the race first.",
          variant: "destructive",
        });
        router.push('/');
      }
    }
  }, [raceConfigFromStorage, router, toast, state.isRaceActive, state.config, dispatch]);


  useEffect(() => {
    const officialStartTimestampFromConfig = state.config?.raceOfficialStartTime ? Date.parse(state.config.raceOfficialStartTime) : null;
    let autoStartTimerId: NodeJS.Timeout | null = null;

    if (officialStartTimestampFromConfig && officialStartTimestampFromConfig > Date.now() && !state.isRaceActive && !state.raceCompleted) {
      const timeToAutoStart = officialStartTimestampFromConfig - Date.now();
      autoStartTimerId = setTimeout(() => {
        const currentConfig = raceConfigFromStorage; 
        const currentOfficialStartTime = currentConfig?.raceOfficialStartTime ? Date.parse(currentConfig.raceOfficialStartTime) : null;

        // Check config again in case it changed while timer was pending
        if (Date.now() >= (currentOfficialStartTime || 0) && !state.isRaceActive && !state.raceCompleted && state.config?.raceOfficialStartTime === currentConfig?.raceOfficialStartTime) {
           dispatch({ type: 'START_RACE' });
        }
      }, timeToAutoStart);
    }

    const tickIntervalId = setInterval(() => {
      const currentTickTime = Date.now();
      setNow(currentTickTime);
      if (state.isRaceActive && !state.isRacePaused && !state.raceCompleted) {
        dispatch({ type: 'TICK', payload: { currentTime: currentTickTime } });
      }
    }, 100);

    return () => {
      clearInterval(tickIntervalId);
      if (autoStartTimerId) clearInterval(autoStartTimerId);
    };
  }, [state.isRaceActive, state.isRacePaused, state.raceCompleted, state.config?.raceOfficialStartTime, raceConfigFromStorage, dispatch]);

  useEffect(() => {
    // Persist state.config (which might include modified stint durations) to localStorage
    // only if state.config actually exists and is different from what's in localStorage.
    // This avoids unnecessary writes and potential loops if raceConfigFromStorage is still undefined during initial hydration.
    if (state.config && typeof raceConfigFromStorage !== 'undefined' && JSON.stringify(state.config) !== JSON.stringify(raceConfigFromStorage)) {
      setRaceConfigFromStorage(state.config);
    }
  }, [state.config, raceConfigFromStorage, setRaceConfigFromStorage]);

  const handleStartRace = () => dispatch({ type: 'START_RACE' });
  const handlePauseRace = () => dispatch({ type: 'PAUSE_RACE' });
  const handleResumeRace = () => dispatch({ type: 'RESUME_RACE' });
  const handleResetRace = () => {
     // Reload the original config from storage if available, then reset runtime state
     if (raceConfigFromStorage) {
        dispatch({ type: 'LOAD_CONFIG', payload: raceConfigFromStorage }); 
     } else if (state.config) { 
        // If no storage config, reset with current config structure but initial values
        dispatch({ type: 'RESET_RACE' }); 
     }
  }

  const handleSwapDriverConfirm = (nextDriverId: string, refuel: boolean, nextStintPlannedDuration?: number) => {
    dispatch({ type: 'SWAP_DRIVER', payload: { nextDriverId, refuel, nextStintPlannedDuration } });
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
  const nextPlannedDriver = nextPlannedDriverId ? config.drivers.find(d => d.id === nextPlannedDriverId) : null;
  const nextStintOriginalPlannedDurationMinutes = nextPlannedDriverIndex < config.stintSequence.length ? config.stintSequence[nextPlannedDriverIndex]?.plannedDurationMinutes : undefined;


  const raceNotYetStartedAndHasFutureStartTime = timeToRaceStartMs > 0 && !state.isRaceActive && !state.raceCompleted;
  const canDisplayUpcomingStintsList = config.stintSequence.length > 0 && state.currentStintIndex < config.stintSequence.length && !state.raceCompleted;
  const canDisplayCompletedStintsList = state.completedStints && state.completedStints.length > 0;

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
          <TimerDisplay label="Race Time Remaining" timeMs={raceTimeRemainingMs} isLoading={!state.isRaceActive && !state.raceCompleted && !raceNotYetStartedAndHasFutureStartTime && raceTimeRemainingMs === config.raceDurationMinutes * 60 * 1000} />
          <TimerDisplay label="Current Driver Time" timeMs={stintElapsedTimeMs} isLoading={!state.isRaceActive || raceNotYetStartedAndHasFutureStartTime} />
          <TimerDisplay
            label="Fuel Time Remaining"
            timeMs={fuelTimeRemainingMs}
            variant={state.fuelAlertActive ? "warning" : "default"}
            isLoading={!state.isRaceActive || raceNotYetStartedAndHasFutureStartTime}
          />
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
        <Card className="shadow-lg lg:col-span-2">
          <CardHeader>
             <CardTitle className="text-xl font-semibold text-primary">Current Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm text-muted-foreground">Current Driver</p>
                <p className="text-2xl font-semibold text-primary">{currentDriver?.name || "N/A"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Next Planned Driver</p>
                <p className="text-xl font-medium">{nextPlannedDriver?.name || (state.currentStintIndex +1 >= config.stintSequence.length ? "End of sequence" : "N/A")}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Stint</p>
                <p className="text-2xl font-semibold">{state.currentStintIndex + 1} / {config.stintSequence.length}</p>
              </div>
            </div>
            <div>
              <Label className="text-sm text-muted-foreground">Fuel Level ({fuelDurationForCurrentStintMinutes} min tank)</Label>
              <Progress value={fuelPercentage} className="w-full h-3 mt-1 [&>div]:bg-primary" />
              <p className="text-xs text-right text-muted-foreground mt-0.5">{fuelPercentage.toFixed(0)}%</p>
            </div>
          </CardContent>
        </Card>

        {canDisplayUpcomingStintsList && (
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-xl font-semibold text-primary flex items-center">
                <Users className="mr-2 h-5 w-5" /> Upcoming Stints
              </CardTitle>
               <UICardDescription>
                 {state.isRaceActive ? "Dynamically updated planned start times." : (hasOfficialStartTime ? "Planned times based on official start." : "Sequence of drivers and planned durations.")}
               </UICardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-[200px]">
                <ScrollArea className="h-full w-full pr-3">
                  {(() => {
                      const upcomingStintsToRender = [];
                      const displayFromStintIndex = state.currentStintIndex + 1;

                      let nextStintBaseTimeMs: number;

                      if (state.isRaceActive && state.stintStartTime !== null && state.config) {
                          // For active race, base time is current stint's actual start time + its *planned* duration
                          const currentStintData = state.config.stintSequence[state.currentStintIndex];
                          const currentStintPlannedDurationMs = (currentStintData?.plannedDurationMinutes || state.config.fuelDurationMinutes) * 60000;
                          nextStintBaseTimeMs = state.stintStartTime + currentStintPlannedDurationMs;
                      } else if (hasOfficialStartTime && officialStartTimestamp !== null && state.config) {
                          // For pre-race with official start, calculate sum of planned durations up to the *next* stint
                          nextStintBaseTimeMs = officialStartTimestamp;
                          for (let k = 0; k < displayFromStintIndex; k++) { // Sum durations *before* the first upcoming stint
                              const pastStintDurationMs = (state.config.stintSequence[k]?.plannedDurationMinutes || state.config.fuelDurationMinutes) * 60000;
                              nextStintBaseTimeMs += pastStintDurationMs;
                          }
                      } else {
                          nextStintBaseTimeMs = 0; // No time reference, won't show clock times
                      }

                      let cumulativeDurationForUpcomingMs = 0;

                      if (state.config) {
                          for (let i = displayFromStintIndex; i < state.config.stintSequence.length; i++) {
                            const stintEntry = state.config.stintSequence[i];
                            const driver = state.config.drivers.find(d => d.id === stintEntry.driverId);
                            const stintPlannedDurationMinutes = stintEntry.plannedDurationMinutes || state.config.fuelDurationMinutes;

                            let thisStintExpectedStartTimeMs: number | null = null;

                            // Only calculate clock time if we have a valid base time
                            if (nextStintBaseTimeMs !== 0) {
                               thisStintExpectedStartTimeMs = nextStintBaseTimeMs + cumulativeDurationForUpcomingMs;
                               // For the *next* iteration, add current stint's duration
                               cumulativeDurationForUpcomingMs += stintPlannedDurationMinutes * 60000;
                            }
                            
                            // Highlight logic for pre-race scenario focusing on the very first stint in sequence
                            const isCurrentPreRaceHighlight = !state.isRaceActive && hasOfficialStartTime && i === 0 && displayFromStintIndex === 0 && thisStintExpectedStartTimeMs && thisStintExpectedStartTimeMs > currentTimeForCalcs;


                            upcomingStintsToRender.push(
                              <li key={`${stintEntry.driverId}-${i}`} className={`p-3 rounded-md border flex justify-between items-center ${isCurrentPreRaceHighlight ? 'bg-primary/10 border-primary' : 'bg-muted/30'}`}>
                                <div>
                                  <p className={`font-medium ${isCurrentPreRaceHighlight ? 'text-primary' : ''}`}>{driver?.name || "N/A"}</p>
                                  <p className="text-xs text-muted-foreground">
                                    Stint #{i + 1} ({stintPlannedDurationMinutes} min)
                                  </p>
                                </div>
                                {thisStintExpectedStartTimeMs !== null && nextStintBaseTimeMs !== 0 ? (
                                  <p className="text-sm font-semibold text-right">
                                    {new Date(thisStintExpectedStartTimeMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    {new Date(thisStintExpectedStartTimeMs).toLocaleDateString() !== new Date(currentTimeForCalcs).toLocaleDateString() &&
                                     ` (${new Date(thisStintExpectedStartTimeMs).toLocaleDateString([], {month: 'short', day: 'numeric'})})`}
                                  </p>
                                ) : (
                                   <p className="text-sm text-muted-foreground text-right">
                                     {/* Placeholder or empty if no time can be calculated */}
                                   </p>
                                )}
                              </li>
                            );
                          }
                      }


                      if (upcomingStintsToRender.length === 0) {
                        return <p className="text-muted-foreground text-sm">
                          {config.stintSequence.length === 0 ? "No stints planned." : (state.currentStintIndex >= config.stintSequence.length -1 ? "Final stint or all stints complete." : "Calculating...")}
                        </p>;
                      }
                      return <ul className="space-y-3">{upcomingStintsToRender}</ul>;
                    })()}
                  </ScrollArea>
                </div>
            </CardContent>
          </Card>
        )}

        {canDisplayCompletedStintsList && (
          <Card className="shadow-lg lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-xl font-semibold text-primary flex items-center">
                <History className="mr-2 h-5 w-5" /> Completed Stints
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-[300px]">
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
              </ScrollArea>
            </CardContent>
          </Card>
        )}
      </div>


      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {!state.isRaceActive && !state.raceCompleted && (
          <Button
            onClick={handleStartRace}
            size="lg"
            className="col-span-2 md:col-span-1 bg-primary hover:bg-primary/80 text-primary-foreground"
            disabled={raceNotYetStartedAndHasFutureStartTime}
          >
            <Play className="mr-2 h-5 w-5" /> Start Race
          </Button>
        )}
        {state.isRaceActive && !state.isRacePaused && !state.raceCompleted && (
          <Button onClick={handlePauseRace} variant="outline" size="lg" className="col-span-2 md:col-span-1">
            <Pause className="mr-2 h-5 w-5" /> Pause Race
          </Button>
        )}
        {state.isRaceActive && state.isRacePaused && !state.raceCompleted && (
          <Button onClick={handleResumeRace} size="lg" className="col-span-2 md:col-span-1 bg-primary hover:bg-primary/80 text-primary-foreground">
            <Play className="mr-2 h-5 w-5" /> Resume Race
          </Button>
        )}

        <Button
          onClick={() => setDriverSwapDialogOpen(true)}
          size="lg"
          disabled={!state.isRaceActive || state.isRacePaused || state.raceCompleted || raceNotYetStartedAndHasFutureStartTime || state.currentStintIndex >= config.stintSequence.length -1}
          className="col-span-2 md:col-span-1"
        >
          <Users className="mr-2 h-5 w-5" /> Swap Driver
        </Button>

        <Button
          onClick={handleResetRace}
          variant="destructive"
          size="lg"
          className="col-span-full md:col-span-2"
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
    </div>
  );
}

