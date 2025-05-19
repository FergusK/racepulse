import { Fuel } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur-sm">
      <div className="container flex h-16 items-center justify-between space-x-4 sm:space-x-0">
        <Link href="/" className="flex items-center space-x-2">
          <Fuel className="h-7 w-7 text-primary" />
          <span className="text-xl font-bold tracking-tight sm:inline-block text-primary">
            RacePulse
          </span>
        </Link>
        <nav className="flex items-center space-x-2">
          <Button variant="ghost" asChild>
            <Link href="/">Setup</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/race">Race</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
