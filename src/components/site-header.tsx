
"use client";

import { Fuel } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

export function SiteHeader() {
  const router = useRouter();

  // Direct navigation to setup, no warning dialog.
  // The RaceInterface component is responsible for loading persisted state.
  // It will also reset if settings are actually changed on the setup page.
  const handleSetupNavigation = () => {
    router.push('/');
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
      {/* AlertDialog has been removed */}
    </>
  );
}

