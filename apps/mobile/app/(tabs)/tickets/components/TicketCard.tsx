import { format, parseISO } from 'date-fns';
import { useEffect } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming
} from 'react-native-reanimated';

import { useThemeColors, useThemedStyles } from '@/lib/colors';
import { Ionicons } from '@/lib/icons';

import {
  formatAgentLabel,
  getTicketCheckboxColors,
  getTicketDisplayTitle,
  type TicketWithProject
} from './shared';
import { createTicketsScreenStyles } from './TicketsScreenStyles';

type TicketCardProps = {
  ticket: TicketWithProject;
  projectColor: string;
  projects: { id: string; name: string; color: string }[];
  showProjectName?: boolean;
  isActive?: boolean;
  onPress: () => void;
  onComplete?: () => void;
  onDragHandleLongPress?: () => void;
};

const executionIconColors = ({ isDark }: { isDark: boolean }) =>
  ({
    agent: isDark ? '#34d399' : '#059669',
    human: isDark ? '#fbbf24' : '#b45309'
  }) as const;

const SHIMMER_STRIP_WIDTH = 120;
const EMERALD_SHIMMER = 'rgba(16, 185, 129, 0.18)';
const EMERALD_DOT = '#10b981';

export function TicketCard({
  ticket,
  projectColor,
  projects,
  showProjectName = false,
  isActive = false,
  onPress,
  onComplete,
  onDragHandleLongPress
}: TicketCardProps) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createTicketsScreenStyles);
  const { width: screenWidth } = useWindowDimensions();
  const agentLabel = formatAgentLabel(ticket.assigned_agent);
  const ticketProject = projects.find(p => p.id === ticket.project_id) ?? null;
  const ticketProjectColor = ticketProject?.color || projectColor;
  const projectLabel = ticketProject?.name ?? 'Personal';
  const dueLabel = ticket.due_datetime ? format(parseISO(ticket.due_datetime), 'MMM d') : null;
  const execColors = executionIconColors({ isDark: colors.isDark });
  const executionColor = ticket.execution_target === 'agent' ? execColors.agent : execColors.human;
  const showProjectHint = showProjectName && projectLabel.length > 0 && projectLabel !== 'Personal';
  const isAgentRunning = ticket.has_executing_objective === true;
  const isComplete = ticket.status.trim().toLowerCase() === 'complete';
  const checkboxColors = getTicketCheckboxColors(ticketProjectColor);

  const shimmerX = useSharedValue(-SHIMMER_STRIP_WIDTH);

  useEffect(() => {
    if (isAgentRunning) {
      shimmerX.value = -SHIMMER_STRIP_WIDTH;
      shimmerX.value = withRepeat(
        withTiming(screenWidth + SHIMMER_STRIP_WIDTH, {
          duration: 2000,
          easing: Easing.linear
        }),
        -1,
        false
      );
    } else {
      cancelAnimation(shimmerX);
      shimmerX.value = -SHIMMER_STRIP_WIDTH;
    }
  }, [isAgentRunning, screenWidth, shimmerX]);

  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shimmerX.value }]
  }));

  return (
    <Pressable
      style={({ pressed }) => [
        styles.ticketListRow,
        ticket.has_unread && styles.ticketListRowUnread,
        isAgentRunning && { borderColor: 'rgba(16, 185, 129, 0.35)', overflow: 'hidden' },
        isComplete && styles.ticketListRowComplete,
        isActive && styles.ticketListRowDragging,
        pressed && styles.pressed
      ]}
      onPress={onPress}
    >
      {/* Running agent shimmer sweep */}
      {isAgentRunning && (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 0,
              bottom: 0,
              width: SHIMMER_STRIP_WIDTH,
              backgroundColor: EMERALD_SHIMMER
            },
            shimmerStyle
          ]}
        />
      )}

      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={isComplete ? 'Ticket completed' : 'Mark ticket complete'}
        accessibilityState={{ checked: isComplete, disabled: isComplete }}
        hitSlop={8}
        disabled={isComplete}
        onPressIn={event => {
          event.stopPropagation();
        }}
        onPress={event => {
          event.stopPropagation();
          if (!isComplete) {
            onComplete?.();
          }
        }}
        style={[
          styles.ticketCheckbox,
          {
            borderColor: checkboxColors.borderColor ?? colors.border,
            backgroundColor: isComplete
              ? (checkboxColors.completedBackgroundColor ?? colors.primary)
              : (checkboxColors.backgroundColor ?? 'transparent')
          }
        ]}
      >
        <Ionicons
          name="checkmark"
          size={10}
          color={isComplete ? (checkboxColors.checkColor ?? colors.background) : 'transparent'}
        />
      </Pressable>
      <View style={styles.ticketListMain}>
        <Text
          style={[styles.ticketListTitle, isComplete && styles.ticketListTitleComplete]}
          numberOfLines={1}
        >
          {getTicketDisplayTitle(ticket)}
        </Text>
        {(dueLabel || agentLabel) && (
          <View style={styles.ticketListSubrows}>
            {dueLabel ? (
              <View style={styles.ticketListDue}>
                <Ionicons name="calendar-outline" size={10} color={colors.mutedForeground} />
                <Text style={styles.ticketListDueText}>{dueLabel}</Text>
              </View>
            ) : null}
            {/* {agentLabel ? (
              <View style={styles.ticketListAgentRow}>
                <Ionicons
                  name={
                    ticket.execution_target === 'agent' ? 'hardware-chip-outline' : 'person-outline'
                  }
                  size={10}
                  color={ticket.execution_target === 'agent' ? '#ea580c' : colors.mutedForeground}
                />
                <Text
                  style={[
                    styles.ticketListAgentText,
                    {
                      color:
                        ticket.execution_target === 'agent' ? '#ea580c' : colors.mutedForeground
                    }
                  ]}
                  numberOfLines={1}
                >
                  {agentLabel}
                </Text>
              </View>
            ) : null} */}
          </View>
        )}
      </View>
      <View style={styles.ticketListRight}>
        {showProjectHint ? (
          <Text style={styles.ticketListProjectHint} numberOfLines={2}>
            {projectLabel}
          </Text>
        ) : null}

        {/* Running agent dot — mirrors web green dot */}
        {isAgentRunning && (
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: EMERALD_DOT,
              flexShrink: 0
            }}
          />
        )}

        <View style={styles.ticketListExecWrap}>
          <Ionicons
            name={ticket.execution_target === 'agent' ? 'hardware-chip-outline' : 'person-outline'}
            size={14}
            color={executionColor}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Drag ticket"
          hitSlop={8}
          delayLongPress={120}
          onPressIn={event => {
            event.stopPropagation();
          }}
          onLongPress={event => {
            event.stopPropagation();
            onDragHandleLongPress?.();
          }}
          onPress={event => {
            event.stopPropagation();
          }}
          style={styles.ticketDragHandle}
        >
          <Ionicons name="reorder-three-outline" size={16} color={colors.mutedForeground} />
        </Pressable>
        {ticket.has_unread ? <View style={styles.unreadDot} /> : null}
      </View>
    </Pressable>
  );
}
