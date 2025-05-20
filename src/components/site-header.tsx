
"use client";

import { Fuel } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RACE_STATE_LOCAL_STORAGE_KEY_FULL } from '@/lib/config';
import type { CurrentRaceState } from '@/lib/types';

export function SiteHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const [isAlertDialogOpen, setAlertDialogOpen] = useState(false);

  const handleSetupNavigation = () => {
    if (pathname === '/race') {
      if (typeof window !== 'undefined') {
        const rawSavedState = window.localStorage.getItem(RACE_STATE_LOCAL_STORAGE_KEY_FULL);
        if (rawSavedState) {
          try {
            const parsedState: CurrentRaceState = JSON.parse(rawSavedState);
            // Check if a race has started and is not yet completed
            if (parsedState && parsedState.raceStartTime !== null && !parsedState.raceCompleted) {
              setAlertDialogOpen(true);
              return; // Stop navigation, show dialog
            }
          } catch (e) {
            console.error("Error parsing race state for navigation warning:", e);
            // Fall through to direct navigation if parsing fails
          }
        }
      }
    }
    // If not on /race, or no active/progressing race found, or error
    router.push('/');
  };

  const confirmNavigationToSetup = () => {
    router.push('/');
    setAlertDialogOpen(false);
  };

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur-sm">
        <div className="container flex h-16 items-center justify-between space-x-4 sm:space-x-0">
          <Link href="/" className="flex items-center space-x-2">
            <Fuel className="h-7 w-7 text-primary" />
            <span className="text-xl font-bold tracking-tight sm:inline-block text-primary">
              RacePulse
            </span>
          </Link>
          <nav className="flex items-center space-x-2">
            <Button variant="ghost" onClick={handleSetupNavigation}>
              Setup
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/race">Race</Link>
            </Button>
          </nav>
        </div>
      </header>

      <AlertDialog open={isAlertDialogOpen} onOpenChange={setAlertDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard Race Progress?</AlertDialogTitle>
            <AlertDialogDescription>
              Navigating to the Setup page will reset your current race progress. This action cannot be undone. Are you sure you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setAlertDialogOpen(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmNavigationToSetup}>
              Continue to Setup
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
