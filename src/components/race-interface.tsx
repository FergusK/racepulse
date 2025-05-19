
"use client";

import type { RaceConfiguration, CurrentRaceState, Driver } from '@/lib/types';
import { useState, useEffect, useCallback, useReducer } from 'react';
import { useRouter } from 'next/navigation';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { RACE_CONFIG_LOCAL_STORAGE_KEY, LOW_FUEL_THRESHOLD_MINUTES } from '@/lib/config';
import { TimerDisplay } from '@/components/timer-display';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DriverSwapDialog } from '@/components/driver-swap-dialog';
import { Progress } from "@/components/ui/progress";
import { Play, Pause, RotateCcw, Users, Fuel, Flag, AlertTriangle, SkipForward } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

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
  if (!config && action.type !== 'LOAD_CONFIG') return state; // Config must be loaded

  const currentTime = action.type === 'TICK' ? action.payload.currentTime : Date.now();

  switch (action.type) {
    case 'LOAD_CONFIG':
      return {
        ...initialRaceState,
        config: action.payload,
        currentDriverId: action.payload.stintSequence.length > 0 ? action.payload.stintSequence[0] : null,
      };
    case 'START_RACE':
      if (!config) return state;
      const raceStartTime = currentTime;
      const raceFinishTime = raceStartTime + config.raceDurationMinutes * 60 * 1000;
      return {
        ...state,
        isRaceActive: true,
        isRacePaused: false,
        raceStartTime,
        pauseTime: null,
        accumulatedPauseDuration: 0,
        currentStintIndex: 0,
        currentDriverId: config.stintSequence[0],
        stintStartTime: raceStartTime,
        fuelTankStartTime: raceStartTime,
        raceFinishTime,
        raceCompleted: false,
      };
    case 'PAUSE_RACE':
      return { ...state, isRacePaused: true, pauseTime: currentTime };
    case 'RESUME_RACE':
      if (!state.pauseTime) return state;
      const newAccumulatedPauseDuration = state.accumulatedPauseDuration + (currentTime - state.pauseTime);
      return {
        ...state,
        isRacePaused: false,
        pauseTime: null,
        accumulatedPauseDuration: newAccumulatedPauseDuration,
        // Adjust finish time due to pause
        raceFinishTime: state.raceFinishTime ? state.raceFinishTime + (currentTime - state.pauseTime) : null,
      };
    case 'RESET_RACE':
      return { ...initialRaceState, config, currentDriverId: config ? config.stintSequence[0] : null };
    case 'SWAP_DRIVER':
      if (!config) return state;
      const { nextDriverId, refuel } = action.payload;
      return {
        ...state,
        currentStintIndex: state.currentStintIndex + 1,
        currentDriverId: nextDriverId,
        stintStartTime: currentTime,
        fuelTankStartTime: refuel ? currentTime : state.fuelTankStartTime, // Reset fuel if refueled
      };
    case 'TICK':
      if (!state.isRaceActive || state.isRacePaused || !config || state.raceCompleted) return state;

      // Check for race completion
      if (state.raceFinishTime && currentTime >= state.raceFinishTime) {
        return { ...state, raceCompleted: true, isRaceActive: false, isRacePaused: false };
      }
      
      const fuelElapsedTimeMs = state.fuelTankStartTime ? currentTime - state.fuelTankStartTime : 0;
      const fuelDurationMs = config.fuelDurationMinutes * 60 * 1000;
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
  const [raceConfig] = useLocalStorage<RaceConfiguration | null>(RACE_CONFIG_LOCAL_STORAGE_KEY, null);
  
  const [state, dispatch] = useReducer(raceReducer, { ...initialRaceState, config: raceConfig });
  
  const [isDriverSwapDialogOpen, setDriverSwapDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (raceConfig) {
      dispatch({ type: 'LOAD_CONFIG', payload: raceConfig });
      setIsLoading(false);
    } else if (raceConfig === null) { // Explicitly check for null (meaning it was loaded as null)
      toast({
        title: "Configuration Missing",
        description: "No race configuration found. Please set up the race first.",
        variant: "destructive",
      });
      router.push('/'); // Redirect if no config
      // setIsLoading will remain true, or set to false after redirect.
    }
    // Else, raceConfig is undefined (still loading from localStorage), so wait.
  }, [raceConfig, router, toast]);


  useEffect(() => {
    if (!state.isRaceActive || state.isRacePaused || state.raceCompleted) return;

    const timerId = setInterval(() => {
      setNow(Date.now());
      dispatch({ type: 'TICK', payload: { currentTime: Date.now() } });
    }, 100); // Update 10 times per second for smoother timers

    return () => clearInterval(timerId);
  }, [state.isRaceActive, state.isRacePaused, state.raceCompleted]);


  const handleStartRace = () => dispatch({ type: 'START_RACE' });
  const handlePauseRace = () => dispatch({ type: 'PAUSE_RACE' });
  const handleResumeRace = () => dispatch({ type: 'RESUME_RACE' });
  const handleResetRace = () => {
     dispatch({ type: 'RESET_RACE' });
     setNow(Date.now()); // Reset current time display
  }

  const handleSwapDriverConfirm = (nextDriverId: string, refuel: boolean) => {
    dispatch({ type: 'SWAP_DRIVER', payload: { nextDriverId, refuel } });
    setDriverSwapDialogOpen(false);
    setNow(Date.now());
  };

  if (isLoading || !state.config) {
    return (
      <div className="container mx-auto py-8 text-center">
        <p className="text-xl text-muted-foreground">Loading Race Data...</p>
        {/* Consider adding a Skeleton loader here */}
      </div>
    );
  }

  const { config } = state;
  const currentTimeForCalcs = state.isRacePaused && state.pauseTime ? state.pauseTime : now;

  // Race Timer
  const raceElapsedTimeMs = state.raceStartTime && state.isRaceActive
    ? currentTimeForCalcs - state.raceStartTime - state.accumulatedPauseDuration
    : 0;
  const raceTimeRemainingMs = Math.max(0, (config.raceDurationMinutes * 60 * 1000) - raceElapsedTimeMs);

  // Stint Timer
  const stintElapsedTimeMs = state.stintStartTime && state.isRaceActive
    ? currentTimeForCalcs - state.stintStartTime
    : 0;

  // Fuel Timer
  const fuelElapsedTimeMs = state.fuelTankStartTime && state.isRaceActive
    ? currentTimeForCalcs - state.fuelTankStartTime
    : 0;
  const fuelTimeRemainingMs = Math.max(0, (config.fuelDurationMinutes * 60 * 1000) - fuelElapsedTimeMs);
  const fuelPercentage = Math.max(0, (fuelTimeRemainingMs / (config.fuelDurationMinutes * 60 * 1000)) * 100);
  
  const currentDriver = config.drivers.find(d => d.id === state.currentDriverId);
  const nextPlannedDriverIndex = state.currentStintIndex + 1;
  const nextPlannedDriverId = nextPlannedDriverIndex < config.stintSequence.length ? config.stintSequence[nextPlannedDriverIndex] : null;
  const nextPlannedDriver = nextPlannedDriverId ? config.drivers.find(d => d.id === nextPlannedDriverId) : null;

  return (
    <div className="container mx-auto py-8 px-4">
      <Card className="mb-8 shadow-xl border-primary/20">
        <CardHeader className="pb-4">
          <CardTitle className="text-3xl font-bold text-primary flex items-center">
            <Flag className="mr-3 h-8 w-8" /> Race Monitor
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <TimerDisplay label="Race Time Remaining" timeMs={raceTimeRemainingMs} isLoading={!state.isRaceActive && !state.raceCompleted && raceTimeRemainingMs === 0} />
          <TimerDisplay label="Current Driver Time" timeMs={stintElapsedTimeMs} isLoading={!state.isRaceActive} />
          <TimerDisplay 
            label="Fuel Time Remaining" 
            timeMs={fuelTimeRemainingMs} 
            variant={state.fuelAlertActive ? "warning" : "default"}
            isLoading={!state.isRaceActive} 
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
            The race has concluded. Total time: {TimerDisplay({timeMs: config.raceDurationMinutes * 60 * 1000, label:''})['props']['timeMs'] && formatTime(config.raceDurationMinutes * 60 * 1000)}.
          </AlertDescription>
        </Alert>
      )}


      <Card className="mb-8 shadow-lg">
        <CardContent className="pt-6 space-y-4">
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
            <Label className="text-sm text-muted-foreground">Fuel Level</Label>
            <Progress value={fuelPercentage} className="w-full h-3 mt-1 [&>div]:bg-primary" />
            <p className="text-xs text-right text-muted-foreground mt-0.5">{fuelPercentage.toFixed(0)}%</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {!state.isRaceActive && !state.raceCompleted && (
          <Button onClick={handleStartRace} size="lg" className="col-span-2 md:col-span-1 bg-primary hover:bg-primary/80 text-primary-foreground">
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
          disabled={!state.isRaceActive || state.isRacePaused || state.raceCompleted}
          className="col-span-2 md:col-span-1"
        >
          <Users className="mr-2 h-5 w-5" /> Swap Driver
        </Button>
        
        <Button onClick={handleResetRace} variant="destructive" size="lg" className="col-span-full md:col-span-2">
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

// Helper function for formatting, can be moved to utils if used elsewhere
function formatTime(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}


    