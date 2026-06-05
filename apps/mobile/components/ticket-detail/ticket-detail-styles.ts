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
    scrollContent: { paddingBottom: 120, paddingTop: 120 },
    headerTitlePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      maxWidth: 260,
      overflow: 'hidden',
      boxShadow: '0 0 10px 0 rgba(0, 0, 0, 0.1)'
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
    headerIconPressable: { marginRight: 0 },
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
      backgroundColor: 'rgba(0,0,0,0.15)',

      paddingHorizontal: 12,
      paddingTop: Platform.OS === 'ios' ? 56 : 24
    },
    headerSheetWrap: {
      width: '100%'
    },
    headerSheetExpanded: {
      width: '100%',
      borderRadius: 24,
      overflow: 'hidden',
      boxShadow: '0 0 10px 0 rgba(0,0,0,0.1)'
    },
    headerSheetContent: {
      padding: 12,
      gap: 10
    },
    headerSheetPickerSection: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)',
      paddingTop: 12
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
    timerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 10,
      paddingVertical: 12,
      borderRadius: 12,
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'
    },
    timerCopy: { flex: 1, minWidth: 0 },
    timerLabel: { color: colors.foreground, fontSize: 15, fontWeight: '600' },
    timerMeta: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
    timerError: { color: colors.destructive, fontSize: 12, marginTop: 4 },
    timerButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      minWidth: 84,
      height: 36,
      paddingHorizontal: 12,
      borderRadius: 999
    },
    timerButtonStart: { backgroundColor: colors.primary },
    timerButtonStop: {
      backgroundColor: colors.isDark ? 'rgba(239,68,68,0.16)' : 'rgba(239,68,68,0.12)',
      borderWidth: 1,
      borderColor: colors.destructive
    },
    timerButtonDisabled: { opacity: 0.6 },
    timerButtonText: {
      color: colors.primaryForeground,
      fontSize: 13,
      fontWeight: '600',
      fontVariant: ['tabular-nums']
    },
    timerButtonTextStop: { color: colors.destructive },
    titleBlock: { paddingHorizontal: 16, marginBottom: 12, gap: 6 },
    sequence: {
      color: colors.mutedForeground,
      fontSize: 12,
      fontWeight: '600',
      fontVariant: ['tabular-nums']
    },
    titlePressable: {
      alignSelf: 'flex-start',
      maxWidth: '100%'
    },
    titleText: { color: colors.foreground, fontSize: 22, fontWeight: '700', lineHeight: 28 },
    titleInput: {
      color: colors.foreground,
      fontSize: 22,
      fontWeight: '700',
      lineHeight: 28,
      padding: 0,
      margin: 0,
      minWidth: 0,
      width: '100%',
      alignSelf: 'stretch',
      includeFontPadding: false
    },
    pillRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      paddingHorizontal: 16,
      marginBottom: 10
    },
    executingBanner: {
      marginHorizontal: 16,
      marginBottom: 10,
      paddingHorizontal: 12,
      paddingVertical: 11,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.isDark ? 'rgba(34, 197, 94, 0.34)' : 'rgba(22, 163, 74, 0.24)',
      backgroundColor: colors.isDark ? 'rgba(34, 197, 94, 0.12)' : 'rgba(22, 163, 74, 0.08)',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12
    },
    executingBannerLeading: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10
    },
    executingPulseDot: {
      width: 10,
      height: 10,
      borderRadius: 999,
      backgroundColor: colors.success,
      ...(Platform.OS === 'ios'
        ? {
            shadowColor: colors.isDark ? '#22c55e' : '#16a34a',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: colors.isDark ? 0.55 : 0.28,
            shadowRadius: colors.isDark ? 10 : 8
          }
        : { elevation: 4 })
    },
    executingBannerCopy: {
      flex: 1,
      minWidth: 0
    },
    executingBannerLabel: {
      color: colors.foreground,
      fontSize: 13,
      fontWeight: '700'
    },
    executingBannerMeta: {
      color: colors.mutedForeground,
      fontSize: 12,
      marginTop: 2
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
    selectorBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20
    },
    selectorCard: {
      width: '100%',
      maxWidth: 420,
      maxHeight: 440,
      backgroundColor: colors.background,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      gap: 12
    },
    selectorHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12
    },
    selectorTitle: { color: colors.foreground, fontSize: 16, fontWeight: '700' },
    selectorCloseButton: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: colors.secondary
    },
    selectorCloseButtonText: { color: colors.foreground, fontSize: 12, fontWeight: '600' },
    selectorScroll: { flexGrow: 0 },
    selectorScrollContent: {
      gap: 8,
      paddingBottom: 4
    },
    selectorEmpty: {
      color: colors.mutedForeground,
      fontSize: 13,
      paddingVertical: 8
    },
    selectorItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderRadius: 12,
      backgroundColor: colors.secondary
    },
    selectorItemSelected: {
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'
    },
    selectorItemLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flex: 1,
      minWidth: 0
    },
    selectorDot: { width: 10, height: 10, borderRadius: 5 },
    selectorItemText: { color: colors.foreground, fontSize: 14, flexShrink: 1 },
    selectorItemTextSelected: { color: colors.foreground, fontWeight: '600' },
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
    draftTabsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingBottom: 10,
      flexGrow: 0
    },
    draftTab: {
      minWidth: 34,
      height: 32,
      paddingHorizontal: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.secondary
    },
    draftTabSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'
    },
    draftTabLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.mutedForeground
    },
    draftTabLabelSelected: {
      color: colors.foreground
    },
    draftTabAdd: {
      minWidth: 38
    },
    draftTabAddDisabled: {
      opacity: 0.45
    },
    draftTabAddLabel: {
      fontSize: 20,
      fontWeight: '300',
      color: colors.mutedForeground,
      lineHeight: 22
    },
    draftInput: {
      color: colors.foreground,
      fontSize: 14,
      lineHeight: 20,
      minHeight: 72,
      padding: 0
    },
    saveObjective: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 8,
      backgroundColor: colors.primary
    },
    saveObjectiveText: { color: colors.primaryForeground, fontSize: 13, fontWeight: '600' },
    draftAttachmentsBlock: {
      marginTop: 10,
      gap: 8
    },
    draftAttachmentsList: {
      gap: 4
    },
    draftAttachmentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 4
    },
    draftAttachmentLabel: {
      flex: 1,
      color: colors.foreground,
      fontSize: 12
    },
    draftActionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8
    },
    attachIconButton: {
      width: 32,
      height: 32,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.secondary,
      borderWidth: 1,
      borderColor: colors.border
    },
    attachIconButtonDisabled: {
      opacity: 0.5
    },
    attachIconButtonActive: {
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
      borderColor: colors.primary
    },
    draftAgentPanel: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 10
    },
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
