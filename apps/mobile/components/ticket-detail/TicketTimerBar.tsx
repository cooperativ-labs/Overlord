import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { useThemeColors, useThemedStyles } from '@/lib/colors';
import type { EverhourTimer } from '@/lib/everhour';
import { useEverhourTimer } from '@/lib/hooks/use-everhour-timer';
import { Ionicons } from '@/lib/icons';

import { createStyles } from './ticket-detail-styles';

function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  }

  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function getElapsedFromTimer(timer: EverhourTimer): number {
  if (typeof timer.duration === 'number') return timer.duration;
  if (typeof timer.today === 'number') return timer.today;
  return 0;
}

/**
 * Compact start/stop time-tracking bar for the ticket detail header sheet.
 * Mirrors the web `TimerButton`: shows running elapsed time for this ticket and
 * toggles the Everhour timer on press.
 */
export function TicketTimerBar({
  ticketId,
  initialTaskId
}: {
  ticketId: string;
  initialTaskId: string | null;
}) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const { isConnected, timer, errorMessage, isBusy, startForTicket, stop } =
    useEverhourTimer(ticketId);
  const [knownTaskId, setKnownTaskId] = useState<string | null>(initialTaskId);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (initialTaskId) {
      setKnownTaskId(previous => previous ?? initialTaskId);
    }
  }, [initialTaskId]);

  const timerTaskId = timer.task?.id ?? null;
  const isRunningThisTicket =
    timer.status === 'active' && knownTaskId !== null && timerTaskId === knownTaskId;

  useEffect(() => {
    if (timer.task?.id) {
      setKnownTaskId(previous => previous ?? timer.task?.id ?? null);
    }
    setElapsedSeconds(getElapsedFromTimer(timer));
  }, [timer]);

  // Tick the local elapsed counter every second while this ticket is running.
  useEffect(() => {
    if (!isRunningThisTicket) return;
    const tick = setInterval(() => {
      setElapsedSeconds(previous => previous + 1);
    }, 1000);
    return () => clearInterval(tick);
  }, [isRunningThisTicket]);

  const buttonLabel = useMemo(() => {
    if (isBusy) return isRunningThisTicket ? 'Stopping…' : 'Starting…';
    if (isRunningThisTicket) return formatElapsed(elapsedSeconds);
    return 'Start';
  }, [elapsedSeconds, isBusy, isRunningThisTicket]);

  async function handlePress() {
    try {
      if (isRunningThisTicket) {
        await stop();
      } else {
        await startForTicket();
      }
    } catch {
      // Error is surfaced via `errorMessage`.
    }
  }

  // Hide entirely until we know Everhour is connected for this user.
  if (isConnected !== true) {
    return null;
  }

  return (
    <View style={styles.timerRow}>
      <Ionicons name="time-outline" size={18} color={colors.foreground} />
      <View style={styles.timerCopy}>
        <Text style={styles.timerLabel}>Time tracking</Text>
        <Text style={styles.timerMeta} numberOfLines={1}>
          {isRunningThisTicket ? 'Timer running for this ticket' : 'Track time on this ticket'}
        </Text>
        {errorMessage ? (
          <Text style={styles.timerError} numberOfLines={2}>
            {errorMessage}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={handlePress}
        disabled={isBusy}
        accessibilityRole="button"
        accessibilityLabel={isRunningThisTicket ? 'Stop timer' : 'Start timer'}
        style={({ pressed }) => [
          styles.timerButton,
          isRunningThisTicket ? styles.timerButtonStop : styles.timerButtonStart,
          isBusy && styles.timerButtonDisabled,
          pressed && !isBusy && styles.pressed
        ]}
      >
        {isBusy ? (
          <ActivityIndicator
            size="small"
            color={isRunningThisTicket ? colors.destructive : colors.primaryForeground}
          />
        ) : (
          <Ionicons
            name={isRunningThisTicket ? 'stop-outline' : 'play'}
            size={14}
            color={isRunningThisTicket ? colors.destructive : colors.primaryForeground}
          />
        )}
        <Text
          style={[styles.timerButtonText, isRunningThisTicket && styles.timerButtonTextStop]}
          numberOfLines={1}
        >
          {buttonLabel}
        </Text>
      </Pressable>
    </View>
  );
}
