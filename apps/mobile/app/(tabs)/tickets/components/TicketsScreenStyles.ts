import { StyleSheet } from 'react-native';

import type { ThemeColors } from '@/lib/colors';

export const createTicketsScreenStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center'
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 10,
      paddingTop: 8,
      paddingBottom: 10
    },
    ghostButton: {
      width: 34,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center'
    },
    searchWrap: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: 10,
      paddingHorizontal: 10,
      height: 36,
      overflow: 'hidden'
    },
    searchWrapFallback: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border
    },
    searchInput: {
      flex: 1,
      color: colors.foreground,
      fontSize: 13,
      padding: 0
    },
    createButton: {
      height: 36,
      paddingHorizontal: 12,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 2,
      overflow: 'hidden'
    },
    projectHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingTop: 6,
      paddingBottom: 10
    },
    projectSquare: {
      width: 14,
      height: 14,
      borderRadius: 3
    },
    projectHeaderName: {
      flex: 1,
      color: colors.foreground,
      fontSize: 17,
      fontWeight: '700'
    },
    projectFilterButton: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center'
    },
    filterRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingBottom: 10
    },
    filterChips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      flex: 1,
      paddingRight: 10
    },
    viewMenuWrap: {
      position: 'relative',
      flexShrink: 0
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border
    },
    chipActive: {
      borderColor: colors.primary
    },
    chipText: {
      color: colors.foreground,
      fontSize: 13
    },
    viewMenuButton: {
      width: 48,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 1,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      flexDirection: 'row'
    },
    viewMenuButtonActive: {
      borderColor: colors.primary,
      backgroundColor: colors.secondary
    },
    menu: {
      marginHorizontal: 16,
      marginBottom: 6,
      backgroundColor: colors.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden'
    },
    menuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border
    },
    menuItemLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8
    },
    menuItemText: {
      color: colors.foreground,
      fontSize: 14
    },
    menuItemTextActive: {
      fontWeight: '600'
    },
    projectMenuLabel: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8
    },
    projectMenuDot: {
      width: 8,
      height: 8,
      borderRadius: 4
    },
    list: {
      paddingHorizontal: 12,
      paddingBottom: 16
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 8,
      paddingHorizontal: 4,
      marginTop: 4
    },
    sectionDot: {
      width: 8,
      height: 8,
      borderRadius: 4
    },
    sectionTitle: {
      flex: 1,
      color: colors.foreground,
      fontSize: 13,
      fontWeight: '700',
      textTransform: 'capitalize'
    },
    sectionCount: {
      color: colors.mutedForeground,
      fontSize: 12,
      fontWeight: '600'
    },
    calendarList: {
      paddingHorizontal: 12,
      paddingBottom: 24,
      gap: 10
    },
    viewMenu: {
      position: 'absolute',
      right: 0,
      top: 44,
      minWidth: 160,
      marginHorizontal: 0,
      marginBottom: 0,
      zIndex: 20,
      elevation: 20
    },
    viewMenuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border
    },
    calendarHeader: {
      gap: 10,
      paddingBottom: 6
    },
    calendarTitle: {
      color: colors.foreground,
      fontSize: 18,
      fontWeight: '700'
    },
    calendarSub: {
      color: colors.mutedForeground,
      fontSize: 13,
      lineHeight: 18
    },
    unscheduledCard: {
      backgroundColor: colors.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      gap: 8
    },
    unscheduledTitle: {
      color: colors.foreground,
      fontSize: 14,
      fontWeight: '700'
    },
    unscheduledSub: {
      color: colors.mutedForeground,
      fontSize: 12
    },
    unscheduledList: {
      gap: 8
    },
    calendarDayCard: {
      backgroundColor: colors.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      gap: 10
    },
    calendarDayCardToday: {
      borderColor: colors.primary
    },
    calendarDayHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12
    },
    calendarDayHeading: {
      flex: 1,
      gap: 4
    },
    calendarDayWeekday: {
      color: colors.foreground,
      fontSize: 16,
      fontWeight: '700'
    },
    calendarDayMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8
    },
    calendarDayLabel: {
      color: colors.mutedForeground,
      fontSize: 13
    },
    calendarTodayBadge: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '700'
    },
    calendarAddButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background
    },
    calendarTickets: {
      gap: 8
    },
    calendarEmptyText: {
      color: colors.mutedForeground,
      fontSize: 13
    },
    pressed: {
      opacity: 0.8
    },
    /** Compact list row — mirrors web TicketListCard */
    ticketListRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 6,
      paddingHorizontal: 8,
      marginBottom: 4,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: 'transparent',
      backgroundColor: colors.card
    },
    ticketListRowUnread: {
      backgroundColor: colors.isDark ? 'rgba(14, 165, 233, 0.12)' : 'rgba(14, 165, 233, 0.08)'
    },
    ticketListProjectDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      flexShrink: 0
    },
    ticketListMain: {
      flex: 1,
      minWidth: 0,
      gap: 2
    },
    ticketListTitle: {
      color: colors.foreground,
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 18
    },
    ticketListSubrows: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      columnGap: 8,
      rowGap: 4
    },
    ticketListDue: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3
    },
    ticketListDueText: {
      color: colors.mutedForeground,
      fontSize: 10
    },
    ticketListAgentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      maxWidth: 160
    },
    ticketListAgentText: {
      fontSize: 10,
      flexShrink: 1
    },
    ticketListRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flexShrink: 0
    },
    ticketListProjectHint: {
      maxWidth: 100,
      color: colors.mutedForeground,
      fontSize: 10
    },
    ticketListExecWrap: {
      opacity: 0.85
    },
    unreadDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.destructive,
      flexShrink: 0
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center'
    },
    empty: {
      alignItems: 'center',
      paddingHorizontal: 32
    },
    emptyText: {
      color: colors.foreground,
      fontSize: 18,
      fontWeight: '600',
      marginTop: 16
    },
    emptySub: {
      color: colors.mutedForeground,
      fontSize: 14,
      textAlign: 'center',
      marginTop: 6
    }
  });
