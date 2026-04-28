import { Platform, StyleSheet } from 'react-native';

import type { ThemeColors } from '@/lib/colors';

export const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background
    },
    errorText: { color: colors.mutedForeground, fontSize: 16 },
    scroll: { flex: 1 },
    scrollContent: { paddingBottom: 40 },
    headerTitlePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      maxWidth: 240,
      overflow: 'hidden'
    },
    headerTitlePillFallback: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border
    },
    headerTitleTextWrap: { flexShrink: 1, minWidth: 0 },
    headerTitleText: { color: colors.foreground, fontSize: 14, fontWeight: '600' },
    headerSubtitleText: {
      color: colors.mutedForeground,
      fontSize: 11,
      marginTop: 1,
      textTransform: 'capitalize'
    },
    headerIconPressable: { marginRight: 4 },
    headerIconButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden'
    },
    headerIconButtonFallback: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border
    },
    headerSheetBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      paddingHorizontal: 12,
      paddingTop: Platform.OS === 'ios' ? 56 : 24
    },
    headerSheetWrap: {
      width: '100%'
    },
    headerSheet: {
      width: '100%',
      borderRadius: 24,
      padding: 12,
      gap: 10,
      overflow: 'hidden'
    },
    headerSheetFallback: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border
    },
    headerSheetTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 4,
      paddingVertical: 6
    },
    headerSheetCircle: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'
    },
    headerSheetTitleWrap: { flex: 1, alignItems: 'center', paddingHorizontal: 6 },
    headerSheetTitle: { color: colors.foreground, fontSize: 15, fontWeight: '700' },
    headerSheetSubtitle: {
      color: colors.mutedForeground,
      fontSize: 12,
      marginTop: 2,
      textTransform: 'capitalize'
    },
    headerSheetChipRow: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 4
    },
    headerSheetChip: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      height: 44,
      borderRadius: 12,
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      paddingHorizontal: 10
    },
    headerSheetChipDisabled: { opacity: 0.45 },
    headerSheetChipLabel: { color: colors.foreground, fontSize: 13, fontWeight: '600' },
    headerSheetFeaturedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 10,
      paddingVertical: 12,
      borderRadius: 12,
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
      marginTop: 4
    },
    headerSheetFeaturedIcon: {
      width: 32,
      height: 32,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'
    },
    headerSheetFeaturedLabel: { color: colors.foreground, fontSize: 15, fontWeight: '600' },
    headerSheetFeaturedMeta: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
    headerSheetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 10,
      paddingVertical: 14,
      borderRadius: 10
    },
    headerSheetRowLabel: { flex: 1, color: colors.foreground, fontSize: 15 },
    headerSheetRowTrailing: { color: colors.mutedForeground, fontSize: 13 },
    tracker: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginHorizontal: 16,
      marginTop: 4,
      marginBottom: 14,
      padding: 12,
      borderRadius: 10,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border
    },
    trackerTextWrap: { flex: 1 },
    trackerHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    trackerLabel: {
      color: colors.mutedForeground,
      fontSize: 11,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.6
    },
    trackerSub: { color: colors.mutedForeground, fontSize: 13, marginTop: 4 },
    trackerButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 8,
      backgroundColor: colors.secondary,
      borderWidth: 1,
      borderColor: colors.border
    },
    trackerButtonText: { color: colors.foreground, fontSize: 13, fontWeight: '600' },
    titleBlock: { paddingHorizontal: 16, marginBottom: 12, gap: 6 },
    sequence: {
      color: colors.mutedForeground,
      fontSize: 12,
      fontWeight: '600',
      fontVariant: ['tabular-nums']
    },
    titleText: { color: colors.foreground, fontSize: 22, fontWeight: '700', lineHeight: 28 },
    pillRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      paddingHorizontal: 16,
      marginBottom: 10
    },
    selectPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      maxWidth: 170
    },
    pillDot: { width: 8, height: 8, borderRadius: 4 },
    selectPillText: { color: colors.foreground, fontSize: 13, textTransform: 'capitalize' },
    projectPickerList: {
      marginHorizontal: 16,
      marginBottom: 8,
      backgroundColor: colors.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden'
    },
    projectPickerItem: {
      padding: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border
    },
    projectPickerItemSelected: { backgroundColor: colors.secondary },
    projectPickerItemText: { color: colors.secondaryForeground, fontSize: 15 },
    projectPickerItemTextSelected: { color: colors.foreground, fontWeight: '600' },
    scheduleRow: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 16,
      marginTop: 4,
      marginBottom: 14
    },
    scheduleButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border
    },
    scheduleText: { color: colors.foreground, fontSize: 13 },
    objectivesBlock: {
      marginHorizontal: 16,
      marginBottom: 12,
      backgroundColor: colors.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden'
    },
    objectiveRow: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border
    },
    objectiveRowHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    objectiveStatusIcon: {},
    objectiveTitleText: { flex: 1, color: colors.foreground, fontSize: 14, fontWeight: '500' },
    objectiveBody: {
      color: colors.secondaryForeground,
      fontSize: 13,
      lineHeight: 19,
      marginTop: 8,
      marginLeft: 26
    },
    draftBlock: {
      marginHorizontal: 16,
      marginBottom: 14,
      padding: 14,
      borderRadius: 12,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      minHeight: 100
    },
    draftInput: {
      color: colors.foreground,
      fontSize: 14,
      lineHeight: 20,
      minHeight: 72,
      padding: 0
    },
    saveObjective: {
      alignSelf: 'flex-end',
      marginTop: 10,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 8,
      backgroundColor: colors.primary
    },
    saveObjectiveText: { color: colors.primaryForeground, fontSize: 13, fontWeight: '600' },
    runSection: { paddingHorizontal: 16, marginBottom: 18 },
    launchServerButton: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      minHeight: 40,
      paddingHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8
    },
    launchServerButtonDisabled: { opacity: 0.45 },
    launchServerButtonText: { color: colors.primaryForeground, fontSize: 14, fontWeight: '600' },
    runHint: { color: colors.mutedForeground, fontSize: 12, marginTop: 8 },
    collapsible: {
      marginHorizontal: 16,
      marginBottom: 2,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border
    },
    collapsibleHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 14
    },
    collapsibleBody: { paddingBottom: 14, gap: 10 },
    sectionLabel: {
      color: colors.mutedForeground,
      fontSize: 11,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.6
    },
    docBlock: { gap: 4 },
    docLabel: { color: colors.mutedForeground, fontSize: 12, fontWeight: '600' },
    docBody: { color: colors.foreground, fontSize: 14, lineHeight: 20 },
    docEmpty: { color: colors.mutedForeground, fontSize: 13, fontStyle: 'italic' },
    documentActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    documentActionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: colors.secondary,
      borderWidth: 1,
      borderColor: colors.border
    },
    documentActionButtonDisabled: { opacity: 0.55 },
    documentActionText: { color: colors.foreground, fontSize: 12, fontWeight: '500' },
    documentUploadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
    documentUploadingText: { color: colors.mutedForeground, fontSize: 12 },
    documentList: { marginTop: 4, borderRadius: 8, overflow: 'hidden' },
    documentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 10,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      marginBottom: 6
    },
    documentName: { flex: 1, color: colors.foreground, fontSize: 13 },
    documentMeta: { color: colors.mutedForeground, fontSize: 11 },
    criteriaInput: {
      minHeight: 96,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      padding: 12,
      color: colors.foreground,
      fontSize: 14,
      lineHeight: 20
    },
    saveCriteriaButton: {
      marginTop: 8,
      alignSelf: 'flex-end',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: colors.primary
    },
    saveCriteriaButtonText: { color: colors.primaryForeground, fontSize: 13, fontWeight: '600' },
    cliCopy: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      padding: 10,
      borderRadius: 8,
      backgroundColor: colors.secondary,
      borderWidth: 1,
      borderColor: colors.border
    },
    cliText: { color: colors.foreground, fontSize: 12, flex: 1 },
    cliHint: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
    activityHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      marginTop: 6
    },
    activityFilter: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: colors.secondary,
      borderWidth: 1,
      borderColor: colors.border
    },
    activityFilterText: { color: colors.foreground, fontSize: 12, fontWeight: '500' },
    noActivity: {
      color: colors.mutedForeground,
      fontSize: 13,
      paddingHorizontal: 16,
      paddingVertical: 10
    },
    eventRow: {
      flexDirection: 'row',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 8
    },
    eventIconBadge: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.secondary,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2
    },
    eventAvatarBadge: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: '#f59e0b22',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
      overflow: 'hidden'
    },
    eventAvatarImage: {
      width: 22,
      height: 22,
      borderRadius: 11
    },
    eventAvatarInitials: {
      color: '#f59e0b',
      fontSize: 8,
      fontWeight: '700'
    },
    eventBlocking: { backgroundColor: 'rgba(239, 68, 68, 0.06)' },
    eventHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    eventType: {
      color: colors.foreground,
      fontSize: 12,
      fontWeight: '600',
      backgroundColor: colors.muted,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4
    },
    eventPhase: { color: colors.mutedForeground, fontSize: 12 },
    eventTime: { color: colors.mutedForeground, fontSize: 11 },
    eventSummary: { color: colors.secondaryForeground, fontSize: 13, lineHeight: 18, marginTop: 4 },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24
    },
    modalCard: {
      width: '100%',
      maxWidth: 420,
      backgroundColor: colors.background,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      gap: 10
    },
    modalTitle: { color: colors.foreground, fontSize: 16, fontWeight: '700', marginBottom: 4 },
    modalDone: {
      marginTop: 6,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: colors.primary,
      alignItems: 'center'
    },
    modalDoneText: { color: colors.primaryForeground, fontSize: 14, fontWeight: '600' },
    overflowRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 6
    },
    overflowText: { color: colors.foreground, fontSize: 14 },
    pressed: { opacity: 0.82 }
  });
