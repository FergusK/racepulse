
"use client";

import type { RaceConfiguration, CurrentRaceState, Driver, StintEntry } from '@/lib/types';
import { useState, useEffect, useCallback, useReducer } from 'react';
import { useRouter } from 'next/navigation';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { RACE_CONFIG_LOCAL_STORAGE_KEY, LOW_FUEL_THRESHOLD_MINUTES } from '@/lib/config';
import { TimerDisplay } from '@/components/timer-display';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription as UICardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DriverSwapDialog } from '@/components/driver-swap-dialog';
import { Progress } from "@/components/ui/progress";
import { Play, Pause, RotateCcw, Users, Fuel, Flag, AlertTriangle, Timer, TimerIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Label } from "@/components/ui/label";

type RaceAction =
  | { type: 'START_RACE' }
  | { type: 'PAUSE_RACE' }
  | { type: 'RESUME_RACE' }
  | { type: 'RESET_RACE' }
  | { type: 'SWAP_DRIVER'; payload: { nextDriverId: string; refuel: boolean } }
  | { type: 'TICK'; payload: { currentTime: number } }
  | { type: 'LOAD_CONFIG'; payload: RaceConfiguration };

const initialRaceState: Omit<CurrentRaceState, 'config'> = {
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
  raceFinishTime: null,
  raceCompleted: false,
};

function raceReducer(state: CurrentRaceState, action: RaceAction): CurrentRaceState {
  const { config } = state;
  
  const currentTime = action.type === 'TICK' ? action.payload.currentTime : Date.now();

  switch (action.type) {
    case 'LOAD_CONFIG':
      return {
        ...initialRaceState,
        config: action.payload,
        currentDriverId: action.payload.stintSequence.length > 0 ? action.payload.stintSequence[0].driverId : null,
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
        fuelTankStartTime: raceStartTime, // Fuel tank starts with the race
        raceFinishTime, 
        raceCompleted: false,
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
      return { ...initialRaceState, config, currentDriverId: config.stintSequence[0].driverId };
    case 'SWAP_DRIVER':
      if (!config) return state;
      const { nextDriverId } = action.payload; // 'refuel' boolean is available from action.payload.refuel if needed for other logic
      return {
        ...state,
        currentStintIndex: state.currentStintIndex + 1,
        currentDriverId: nextDriverId,
        stintStartTime: currentTime,
        fuelTankStartTime: state.fuelTankStartTime, // Always carry over fuel from previous state
      };
    case 'TICK':
      if (!state.isRaceActive || state.isRacePaused || !config || state.raceCompleted) return state;

      if (state.raceFinishTime && currentTime >= state.raceFinishTime) {
        return { ...state, raceCompleted: true, isRaceActive: false, isRacePaused: false };
      }
      
      const currentStintConfig = config.stintSequence[state.currentStintIndex];
      const fuelDurationForCurrentStintMinutes = currentStintConfig?.plannedDurationMinutes || config.fuelDurationMinutes;
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
  const [raceConfigFromStorage] = useLocalStorage<RaceConfiguration | null>(RACE_CONFIG_LOCAL_STORAGE_KEY, null);
  
  const [state, dispatch] = useReducer(raceReducer, { ...initialRaceState, config: raceConfigFromStorage });
  
  const [isDriverSwapDialogOpen, setDriverSwapDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (raceConfigFromStorage) {
      dispatch({ type: 'LOAD_CONFIG', payload: raceConfigFromStorage });
      setIsLoading(false);
    } else if (raceConfigFromStorage === null && !isLoading) { 
      toast({
        title: "Configuration Missing",
        description: "No race configuration found. Please set up the race first.",
        variant: "destructive",
      });
      router.push('/'); 
    }
  }, [raceConfigFromStorage, router, toast, isLoading]);


  useEffect(() => {
    const officialStartTimestampFromConfig = state.config?.raceOfficialStartTime ? Date.parse(state.config.raceOfficialStartTime) : null;
    let autoStartTimerId: NodeJS.Timeout | null = null;

    if (officialStartTimestampFromConfig && officialStartTimestampFromConfig > Date.now() && !state.isRaceActive && !state.raceCompleted) {
      const timeToAutoStart = officialStartTimestampFromConfig - Date.now();
      autoStartTimerId = setTimeout(() => {
        if (Date.now() >= officialStartTimestampFromConfig && !state.isRaceActive && !state.raceCompleted && state.config?.raceOfficialStartTime === raceConfigFromStorage?.raceOfficialStartTime) {
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
  }, [state.isRaceActive, state.isRacePaused, state.raceCompleted, state.config?.raceOfficialStartTime, raceConfigFromStorage?.raceOfficialStartTime]);


  const handleStartRace = () => dispatch({ type: 'START_RACE' });
  const handlePauseRace = () => dispatch({ type: 'PAUSE_RACE' });
  const handleResumeRace = () => dispatch({ type: 'RESUME_RACE' });
  const handleResetRace = () => {
     dispatch({ type: 'RESET_RACE' });
     setNow(Date.now());
  }

  const handleSwapDriverConfirm = (nextDriverId: string, refuel: boolean) => {
    dispatch({ type: 'SWAP_DRIVER', payload: { nextDriverId, refuel } });
    setNow(Date.now());
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
  const timeToRaceStartMs = officialStartTimestamp && officialStartTimestamp > now ? officialStartTimestamp - now : 0;


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

  const raceNotYetStartedAndHasFutureStartTime = timeToRaceStartMs > 0 && !state.isRaceActive && !state.raceCompleted;
  const canDisplayUpcomingStintsList = config.stintSequence.length > 0 && !state.raceCompleted;


  return (
    <div className="container mx-auto py-8 px-4">
      {raceNotYetStartedAndHasFutureStartTime && officialStartTimestamp && (
        <Card className="mb-6 bg-accent/10 border-accent shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-2xl text-accent flex items-center">
              <Timer className="mr-2 h-7 w-7" /> Race Starts In
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
                 {hasOfficialStartTime
                    ? "Planned times based on official start and stint durations."
                    : "Sequence of drivers and their planned stint durations."}
                </UICardDescription>
            </CardHeader>
            <CardContent>
            {(() => {
                const startIndexForDisplay = state.isRaceActive ? state.currentStintIndex + 1 : 0;
                const stintsToRender = [];
                let currentCumulativeTime = officialStartTimestamp; 

                // If no official start, we can't calculate cumulative time for display, but we can list drivers and durations.
                // Pre-calculate cumulative durations if officialStartTime is not set, to show relative timings or just durations.
                let cumulativeDurationOffsetMinutes = 0;


                for (let i = 0; i < config.stintSequence.length; i++) {
                  const stintEntry = config.stintSequence[i];
                  const stintDurationMinutes = stintEntry.plannedDurationMinutes || config.fuelDurationMinutes;
                  const driver = config.drivers.find(d => d.id === stintEntry.driverId);

                  let thisStintPlannedStartTimeMs: number | null = null;
                  if (currentCumulativeTime !== null) { // If official start time IS set
                    if (i === 0) {
                        thisStintPlannedStartTimeMs = currentCumulativeTime;
                    } else {
                         // Add previous stint's duration to the cumulative time
                        const prevStint = config.stintSequence[i-1];
                        const prevStintDuration = prevStint.plannedDurationMinutes || config.fuelDurationMinutes;
                        // This logic might need to be smarter if currentCumulativeTime wasn't just the sum
                        // For simplicity, assume currentCumulativeTime is being correctly advanced.
                        // Let's re-initialize and sum up to current stint if officialStartTime is known
                        thisStintPlannedStartTimeMs = officialStartTimestamp!; // Non-null asserted due to currentCumulativeTime !== null
                        for (let j = 0; j < i; j++) {
                            thisStintPlannedStartTimeMs += (config.stintSequence[j].plannedDurationMinutes || config.fuelDurationMinutes) * 60 * 1000;
                        }
                    }
                  }


                  if (i < startIndexForDisplay) {
                     if (hasOfficialStartTime && currentCumulativeTime !== null) {
                       // This logic for advancing currentCumulativeTime when skipping past stints was missing.
                       // currentCumulativeTime += stintDurationMinutes * 60 * 1000; // This line was commented or missing in thought process, might be needed
                     } else {
                       cumulativeDurationOffsetMinutes += stintDurationMinutes;
                     }
                    continue; 
                  }
                  
                  const isCurrentPreRaceHighlight = !state.isRaceActive && hasOfficialStartTime && i === 0 && thisStintPlannedStartTimeMs && thisStintPlannedStartTimeMs > now;

                  stintsToRender.push(
                    <li key={`${stintEntry.driverId}-${i}`} className={`p-3 rounded-md border flex justify-between items-center ${isCurrentPreRaceHighlight ? 'bg-primary/10 border-primary' : 'bg-muted/30'}`}>
                      <div>
                        <p className={`font-medium ${isCurrentPreRaceHighlight ? 'text-primary' : ''}`}>{driver?.name || "N/A"}</p>
                        <p className="text-xs text-muted-foreground">
                          Stint #{i + 1} ({stintDurationMinutes} min)
                        </p>
                      </div>
                      {thisStintPlannedStartTimeMs !== null && hasOfficialStartTime ? (
                        <p className="text-sm font-semibold text-right">
                          {new Date(thisStintPlannedStartTimeMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {new Date(thisStintPlannedStartTimeMs).toLocaleDateString() !== new Date(now).toLocaleDateString() && 
                           ` (${new Date(thisStintPlannedStartTimeMs).toLocaleDateString([], {month: 'short', day: 'numeric'})})`}
                        </p>
                      ) : !hasOfficialStartTime && (
                         <p className="text-sm text-muted-foreground text-right">
                           {/* Optionally show relative start time or just duration */}
                         </p>
                      )}
                    </li>
                  );
                }

                if (stintsToRender.length === 0) {
                  return <p className="text-muted-foreground text-sm">
                    {config.stintSequence.length === 0 ? "No stints planned in sequence." : (state.isRaceActive ? "All planned stints are in the past or sequence complete." : "No upcoming stints to display at this time.")}
                  </p>;
                }
                return <ul className="space-y-3 max-h-[calc(100vh-20rem)] overflow-y-auto">{stintsToRender}</ul>;
              })()}
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
          disabled={!state.isRaceActive || state.isRacePaused || state.raceCompleted || raceNotYetStartedAndHasFutureStartTime}
          className="col-span-2 md:col-span-1"
        >
          <Users className="mr-2 h-5 w-5" /> Swap Driver
        </Button>
        
        <Button 
          onClick={handleResetRace} 
          variant="destructive" 
          size="lg" 
          className="col-span-full md:col-span-2"
          disabled={raceNotYetStartedAndHasFutureStartTime && !state.isRaceActive}
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
      />
    </div>
  );
}

function formatTime(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

