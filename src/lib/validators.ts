
import { z } from 'zod';

export const driverSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, "Driver name cannot be empty.").max(50, "Driver name too long."),
});

export const stintEntrySchema = z.object({
  driverId: z.string().min(1, "Driver ID in stint cannot be empty."),
  plannedDurationMinutes: z.preprocess(
    (val) => (val === "" || val == null ? undefined : parseFloat(String(val))),
    z.number().positive("Planned duration must be positive if specified.").optional()
  ),
});

export const raceConfigSchema = z.object({
  drivers: z.array(driverSchema).min(1, "At least one driver is required."),
  stintSequence: z.array(stintEntrySchema)
    .min(1, "At least one stint must be planned."),
  fuelDurationMinutes: z.number({invalid_type_error: "Must be a number"})
    .positive("Fuel duration must be a positive number.")
    .min(1, "Fuel duration must be at least 1 minute.")
    .max(1440, "Fuel duration seems too long (max 24h)."), // Max 24 hours
  raceDurationMinutes: z.number({invalid_type_error: "Must be a number"})
    .positive("Race duration must be a positive number.")
    .min(1, "Race duration must be at least 1 minute.")
    .max(2880, "Race duration seems too long (max 48h)."), // Max 48 hours
  raceOfficialStartTime: z.string().refine((val) => {
    if (val === "" || val === undefined || val === null) return true; // Allow empty or undefined
    const parsedDate = Date.parse(val);
    if (isNaN(parsedDate)) return false;
    return true;
  }, { message: "Invalid date and time format. Leave blank to start manually." }).optional(),
}).refine(data => {
    const driverIds = new Set(data.drivers.map(d => d.id));
    return data.stintSequence.every(stint => driverIds.has(stint.driverId));
}, {
    message: "All drivers in stint sequence must exist in the drivers list.",
    path: ["stintSequence"],
});

