
"use client";

import { useState, useEffect, useCallback } from 'react';

type SetValue<T> = (value: T | ((val: T) => T)) => void;

export function useLocalStorage<T>(key: string, initialValue: T): [T, SetValue<T>] {
  const readValue = useCallback((): T => {
    if (typeof window === 'undefined') {
      return initialValue;
    }

    try {
      const item = window.localStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : initialValue;
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  }, [initialValue, key]);

  // Initialize with initialValue to ensure consistency between server and client initial render
  const [storedValue, setStoredValue] = useState<T>(initialValue);

  const setValue: SetValue<T> = useCallback(
    value => {
      if (typeof window === 'undefined') {
        console.warn(
          `Tried setting localStorage key "${key}" even though environment is not a client`
        );
        return;
      }

      try {
        const newValue = value instanceof Function ? value(storedValue) : value;
        window.localStorage.setItem(key, JSON.stringify(newValue));
        setStoredValue(newValue);
        window.dispatchEvent(new Event('local-storage')); // Trigger event for other tabs/windows
      } catch (error) {
        console.warn(`Error setting localStorage key "${key}":`, error);
      }
    },
    [key, storedValue]
  );
  
  // Effect to load value from localStorage after initial hydration on client
  useEffect(() => {
    setStoredValue(readValue());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]); // readValue is memoized with key and initialValue,
            // but we only want this effect to re-run if the key changes,
            // initialValue is typically constant for a hook instance.
            // The original had [readValue] which depends on [initialValue, key].
            // For simplicity and to ensure it runs on mount and if key changes, [key] is sufficient here.
            // To be absolutely safe and mimic original [readValue] dependency: [key, initialValue] or just [readValue]

  // Effect to listen for storage changes from other tabs/windows
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent | CustomEvent) => {
      if ((e as StorageEvent)?.key && (e as StorageEvent).key !== key && e.type !== 'local-storage') {
        return;
      }
      if (e.type === 'local-storage' || (e as StorageEvent).key === key) {
         setStoredValue(readValue());
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('local-storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('local-storage', handleStorageChange);
    };
  }, [key, readValue]); // readValue is appropriate here for the handler

  return [storedValue, setValue];
}

