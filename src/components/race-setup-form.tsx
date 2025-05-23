"use client";

import type { RaceConfiguration, StintEntry } from '@/lib/types';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { raceConfigSchema } from '@/lib/validators';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, PlusCircle, ArrowDown, ArrowUp, Settings2, Play, TimerIcon, Briefcase } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { RACE_CONFIG_LOCAL_STORAGE_KEY } from '@/lib/config';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { DEFAULT_RACE_CONFIG } from '@/lib/types';
import { useEffect } from 'react';

export function RaceSetupForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [savedConfig, setSavedConfig] = useLocalStorage<RaceConfiguration | null>(
    RACE_CONFIG_LOCAL_STORAGE_KEY,
    null
  );

  const form = useForm<RaceConfiguration>({
    resolver: zodResolver(raceConfigSchema),
    defaultValues: savedConfig || DEFAULT_RACE_CONFIG,
  });

  const { fields: drivers, append: appendDriver, remove: removeDriver } = useFieldArray({
    control: form.control,
    name: "drivers",
  });

  const { fields: stintSequence, append: appendStint, remove: removeStint, move: moveStint } = useFieldArray({
    control: form.control,
    name: "stintSequence",
  });
  
  useEffect(() => {
    if (savedConfig) {
      form.reset(savedConfig);
    }
  }, [savedConfig, form]);


  const onSubmit = (data: RaceConfiguration) => {
    data.stintSequence = data.stintSequence.map(stint => ({
      ...stint,
      plannedDurationMinutes: stint.plannedDurationMinutes === null || stint.plannedDurationMinutes === undefined || isNaN(Number(stint.plannedDurationMinutes))
        ? undefined
        : Number(stint.plannedDurationMinutes)
    }));
    // Ensure practiceDurationMinutes is number or undefined
    data.practiceDurationMinutes = data.practiceDurationMinutes === null || data.practiceDurationMinutes === undefined || isNaN(Number(data.practiceDurationMinutes))
        ? undefined
        : Number(data.practiceDurationMinutes);
    // Ensure driverCheckupMinutes is number or undefined
    data.driverCheckupMinutes = data.driverCheckupMinutes === null || data.driverCheckupMinutes === undefined || isNaN(Number(data.driverCheckupMinutes))
        ? undefined
        : Number(data.driverCheckupMinutes);

    setSavedConfig(data);
    toast({
      title: "Configuration Saved",
      description: "Race setup has been saved successfully.",
    });
    router.push('/race');
  };

  const handleAddDriver = () => {
    const newDriverId = `driver${Date.now()}`;
    appendDriver({ id: newDriverId, name: '' });
  };
  
  const handleAddStint = () => {
    const availableDrivers = form.watch('drivers');
    if (availableDrivers.length > 0) {
      appendStint({ driverId: availableDrivers[0].id, plannedDurationMinutes: undefined });
    } else {
      toast({
        title: "Cannot Add Stint",
        description: "Please add at least one driver before planning stints.",
        variant: "destructive",
      });
    }
  };

  const watchDrivers = form.watch('drivers');

  return (
    <div className="container mx-auto py-8 px-4">
      <Card className="max-w-3xl mx-auto shadow-2xl">
        <CardHeader>
          <div className="flex items-center space-x-2">
            <Settings2 className="h-8 w-8 text-primary" />
            <CardTitle className="text-3xl font-bold">Race Setup</CardTitle>
          </div>
          <CardDescription>Configure your race parameters. All settings will be saved locally.</CardDescription>
        </CardHeader>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-8">
            {/* Drivers Configuration */}
            <section>
              <h3 className="text-xl font-semibold mb-3 text-primary">Drivers</h3>
              <div className="space-y-3">
                {drivers.map((field, index) => (
                  <div key={field.id} className="flex items-center space-x-2 p-3 bg-muted/30 rounded-md border">
                    <Input
                      {...form.register(`drivers.${index}.name`)}
                      placeholder={`Driver ${index + 1} Name`}
                      className="flex-grow"
                    />
                    <Input
                      {...form.register(`drivers.${index}.id`)}
                      type="hidden"
                    />
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeDriver(index)} aria-label="Remove Driver">
                      <Trash2 className="h-5 w-5 text-destructive" />
                    </Button>
                  </div>
                ))}
                {form.formState.errors.drivers && <p className="text-sm text-destructive">{form.formState.errors.drivers.message || form.formState.errors.drivers.root?.message}</p>}
              </div>
              <Button type="button" variant="outline" onClick={handleAddDriver} className="mt-3">
                <PlusCircle className="mr-2 h-5 w-5" /> Add Driver
              </Button>
            </section>

            <Separator />

            {/* Stint Sequence Configuration */}
            <section>
              <h3 className="text-xl font-semibold mb-3 text-primary">Stint Sequence</h3>
              <div className="space-y-3">
                {stintSequence.map((field, index) => (
                  <div key={field.id} className="flex items-start space-x-2 p-3 bg-muted/30 rounded-md border">
                    <Label className="w-10 text-sm text-muted-foreground pt-2">#{index + 1}</Label>
                    <div className="flex-grow space-y-2">
                      <Controller
                        control={form.control}
                        name={`stintSequence.${index}.driverId`}
                        render={({ field: controllerField }) => (
                          <Select
                            onValueChange={controllerField.onChange}
                            value={controllerField.value}
                            disabled={watchDrivers.length === 0}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select Driver" />
                            </SelectTrigger>
                            <SelectContent>
                              {watchDrivers.map((driver) => (
                                <SelectItem key={driver.id} value={driver.id}>
                                  {driver.name || `Unnamed Driver (ID: ${driver.id.substring(0,6)}... )`}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                      <div className="flex items-center space-x-2">
                        <TimerIcon className="h-4 w-4 text-muted-foreground" />
                        <Input
                          type="number"
                          {...form.register(`stintSequence.${index}.plannedDurationMinutes`)}
                          placeholder="Opt. Duration (mins)"
                          className="h-9 text-sm"
                          min="1"
                        />
                      </div>
                      {form.formState.errors.stintSequence?.[index]?.plannedDurationMinutes && (
                        <p className="text-sm text-destructive">{form.formState.errors.stintSequence[index]?.plannedDurationMinutes?.message}</p>
                      )}
                       {form.formState.errors.stintSequence?.[index]?.driverId && (
                        <p className="text-sm text-destructive">{form.formState.errors.stintSequence[index]?.driverId?.message}</p>
                      )}
                    </div>
                    <div className="flex flex-col pt-1">
                      <Button type="button" variant="ghost" size="icon" onClick={() => moveStint(index, Math.max(0, index - 1))} disabled={index === 0} aria-label="Move Stint Up">
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                       <Button type="button" variant="ghost" size="icon" onClick={() => moveStint(index, Math.min(stintSequence.length - 1, index + 1))} disabled={index === stintSequence.length - 1} aria-label="Move Stint Down">
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </div>
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeStint(index)} aria-label="Remove Stint" className="pt-1">
                      <Trash2 className="h-5 w-5 text-destructive" />
                    </Button>
                  </div>
                ))}
                {form.formState.errors.stintSequence && typeof form.formState.errors.stintSequence === 'object' && !Array.isArray(form.formState.errors.stintSequence) && <p className="text-sm text-destructive">{form.formState.errors.stintSequence.message || form.formState.errors.stintSequence.root?.message}</p>}
                 {form.formState.errors.root && <p className="text-sm text-destructive">{form.formState.errors.root.message}</p>}
              </div>
              <Button type="button" variant="outline" onClick={handleAddStint} className="mt-3" disabled={watchDrivers.length === 0}>
                <PlusCircle className="mr-2 h-5 w-5" /> Add Stint
              </Button>
            </section>
            
            <Separator />

            {/* Race Configuration */}
            <section>
              <h3 className="text-xl font-semibold mb-3 text-primary">Race Configuration</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="raceDurationMinutes">Race Duration (minutes)</Label>
                  <Input
                    id="raceDurationMinutes"
                    type="number"
                    {...form.register('raceDurationMinutes')}
                    min="1"
                    required
                  />
                  {form.formState.errors.raceDurationMinutes && (
                    <p className="text-sm text-destructive">{form.formState.errors.raceDurationMinutes.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="raceOfficialStartTime">Official Race Start Time (optional)</Label>
                  <Input
                    id="raceOfficialStartTime"
                    type="datetime-local"
                    {...form.register('raceOfficialStartTime')}
                  />
                  <p className="text-xs text-muted-foreground">Leave empty to start the race manually. If set, the race will automatically start at this time.</p>
                  {form.formState.errors.raceOfficialStartTime && (
                    <p className="text-sm text-destructive">{form.formState.errors.raceOfficialStartTime.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fuelDurationMinutes">Fuel Tank Duration (minutes)</Label>
                  <Input
                    id="fuelDurationMinutes"
                    type="number"
                    {...form.register('fuelDurationMinutes')}
                    min="1"
                  />
                  {form.formState.errors.fuelDurationMinutes && (
                    <p className="text-sm text-destructive">{form.formState.errors.fuelDurationMinutes.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fuelWarningThresholdMinutes">Fuel Warning Threshold (minutes)</Label>
                  <Input
                    id="fuelWarningThresholdMinutes"
                    type="number"
                    {...form.register('fuelWarningThresholdMinutes')}
                    min="1"
                    max="60"
                  />
                  {form.formState.errors.fuelWarningThresholdMinutes && (
                    <p className="text-sm text-destructive">{form.formState.errors.fuelWarningThresholdMinutes.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="practiceDurationMinutes">Practice Duration (minutes, optional)</Label>
                  <Input
                    id="practiceDurationMinutes"
                    type="number"
                    {...form.register('practiceDurationMinutes')}
                    min="1"
                  />
                  {form.formState.errors.practiceDurationMinutes && (
                    <p className="text-sm text-destructive">{form.formState.errors.practiceDurationMinutes.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="driverCheckupMinutes">Default Driver Checkup Interval (minutes, optional)</Label>
                  <Input
                    id="driverCheckupMinutes"
                    type="number"
                    {...form.register('driverCheckupMinutes')}
                    min="1"
                    placeholder="Leave empty to disable checkups"
                  />
                  <p className="text-xs text-muted-foreground">Default time between driver checkups. Can be overridden per stint.</p>
                  {form.formState.errors.driverCheckupMinutes && (
                    <p className="text-sm text-destructive">{form.formState.errors.driverCheckupMinutes.message}</p>
                  )}
                </div>
              </div>
            </section>
          </CardContent>
          <CardFooter className="flex justify-end pt-6">
            <Button type="submit" size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground">
              <Play className="mr-2 h-5 w-5" /> Save & Go to Race
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

