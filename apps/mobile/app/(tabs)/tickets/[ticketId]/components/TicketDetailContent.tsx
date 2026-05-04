import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View
} from 'react-native';

import type { PickedFile } from '@/components/DocumentAttachmentsSection';
import { DocumentAttachmentsSection } from '@/components/DocumentAttachmentsSection';
import { useThemeColors, useThemedStyles } from '@/lib/colors';
import { Ionicons } from '@/lib/icons';
import type {
  AgentModelSelection,
  Objective,
  Server,
  TicketDetail,
  TicketEvent
} from '@/lib/types';

import {
  eventLabels,
  getEventIcons,
  getObjectiveStateColors,
  type Project,
  statusPillColor,
  type TicketDocument
} from './ticket-detail-shared';
import { createStyles } from './ticket-detail-styles';

export function TicketDetailContent({
  ticket,
  ticketId,
  dueLabel,
  currentProject,
  projects,
  selectedProjectId,
  showProjectPicker,
  savingProject,
  onToggleProjectPicker,
  onChangeProject,
  objectiveDraft,
  setObjectiveDraft,
  executedObjectives,
  expandedObjectiveIds,
  toggleObjectiveExpanded,
  canSaveObjective,
  objectiveActionLabel,
  savingObjective,
  onSaveObjective,
  promptForServerLaunch,
  isSSHSupported,
  loadingServers,
  launchingServerId,
  resolvedAssignedSelection,
  allServers,
  availableServers,
  documents,
  uploadingDocument,
  showDocuments,
  onToggleDocuments,
  onPickFile,
  onOpenDocument,
  hasEverhourApiKey,
  ticketContext,
  ticketConstraints,
  ticketAcceptanceCriteria,
  showAcceptanceCriteria,
  onToggleAcceptanceCriteria,
  acceptanceCriteriaDraft,
  setAcceptanceCriteriaDraft,
  canSaveAcceptanceCriteria,
  savingAcceptanceCriteria,
  onSaveAcceptanceCriteria,
  showCliQuickstart,
  onToggleCliQuickstart,
  onCopyCliCommand,
  filteredEvents,
  eventProfiles,
  activityFilter,
  onToggleActivityFilter
}: {
  ticket: TicketDetail;
  ticketId: string;
  dueLabel: string | null;
  currentProject: Project | null;
  projects: Project[];
  selectedProjectId: string | null;
  showProjectPicker: boolean;
  savingProject: boolean;
  onToggleProjectPicker: () => void;
  onChangeProject: (nextProjectId: string) => Promise<void>;
  objectiveDraft: string;
  setObjectiveDraft: (value: string) => void;
  executedObjectives: Objective[];
  expandedObjectiveIds: string[];
  toggleObjectiveExpanded: (objectiveId: string) => void;
  canSaveObjective: boolean;
  objectiveActionLabel: string;
  savingObjective: boolean;
  onSaveObjective: () => void;
  promptForServerLaunch: () => void;
  isSSHSupported: boolean;
  loadingServers: boolean;
  launchingServerId: string | null;
  resolvedAssignedSelection: AgentModelSelection | null;
  allServers: Server[];
  availableServers: Server[];
  documents: TicketDocument[];
  uploadingDocument: boolean;
  showDocuments: boolean;
  onToggleDocuments: () => void;
  onPickFile: (file: PickedFile) => void | Promise<void>;
  onOpenDocument: (document: TicketDocument) => void;
  hasEverhourApiKey: boolean;
  ticketContext: string;
  ticketConstraints: string;
  ticketAcceptanceCriteria: string | null;
  showAcceptanceCriteria: boolean;
  onToggleAcceptanceCriteria: () => void;
  acceptanceCriteriaDraft: string;
  setAcceptanceCriteriaDraft: (value: string) => void;
  canSaveAcceptanceCriteria: boolean;
  savingAcceptanceCriteria: boolean;
  onSaveAcceptanceCriteria: () => void;
  showCliQuickstart: boolean;
  onToggleCliQuickstart: () => void;
  onCopyCliCommand: () => void;
  filteredEvents: TicketEvent[];
  eventProfiles: Record<string, { name: string; image_url: string }>;
  activityFilter: 'all' | 'completed';
  onToggleActivityFilter: () => void;
}) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const objectiveStateColors = getObjectiveStateColors(colors);
  const eventIcons = getEventIcons(colors);
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      {hasEverhourApiKey && (
        <View style={styles.tracker}>
          <View style={styles.trackerTextWrap}>
            <View style={styles.trackerHeaderRow}>
              <Text style={styles.trackerLabel}>TIME TRACKING</Text>
              <Ionicons
                name="information-circle-outline"
                size={13}
                color={colors.mutedForeground}
              />
            </View>
            <Text style={styles.trackerSub}>Track time on this ticket.</Text>
          </View>
          <Pressable
            hitSlop={8}
            style={styles.trackerButton}
            onPress={() => Alert.alert('Time tracking', 'Time tracking starts soon.')}
          >
            <Ionicons name="play" size={12} color={colors.foreground} />
            <Text style={styles.trackerButtonText}>Start</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.titleBlock}>
        <Text style={styles.sequence}>#{ticket.ticket_sequence}</Text>
        <Text style={styles.titleText}>{ticket.title || 'Untitled'}</Text>
      </View>

      <View style={styles.pillRow}>
        <Pressable
          style={({ pressed }) => [styles.selectPill, pressed && styles.pressed]}
          onPress={onToggleProjectPicker}
          disabled={savingProject}
        >
          {currentProject && (
            <View
              style={[styles.pillDot, { backgroundColor: currentProject.color || colors.primary }]}
            />
          )}
          <Text style={styles.selectPillText} numberOfLines={1}>
            {currentProject?.name ?? 'No project'}
          </Text>
          {savingProject ? (
            <ActivityIndicator size="small" color={colors.mutedForeground} />
          ) : (
            <Ionicons name="chevron-down" size={12} color={colors.mutedForeground} />
          )}
        </Pressable>

        <View style={styles.selectPill}>
          <View
            style={[styles.pillDot, { backgroundColor: statusPillColor(ticket.status, colors) }]}
          />
          <Text style={styles.selectPillText}>{ticket.status}</Text>
          <Ionicons name="chevron-down" size={12} color={colors.mutedForeground} />
        </View>
      </View>

      {showProjectPicker && (
        <View style={styles.projectPickerList}>
          {projects.map(project => {
            const isSelected = project.id === selectedProjectId;
            return (
              <Pressable
                key={project.id}
                style={[styles.projectPickerItem, isSelected && styles.projectPickerItemSelected]}
                onPress={() => onChangeProject(project.id)}
              >
                <Text
                  style={[
                    styles.projectPickerItemText,
                    isSelected && styles.projectPickerItemTextSelected
                  ]}
                >
                  {project.name}
                </Text>
                {isSelected && <Ionicons name="checkmark" size={16} color={colors.primary} />}
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.scheduleRow}>
        <Pressable
          style={({ pressed }) => [styles.scheduleButton, pressed && styles.pressed]}
          onPress={() =>
            Alert.alert('Due date', dueLabel ? `Due ${dueLabel}` : 'Due date picker coming soon.')
          }
        >
          <Ionicons name="calendar-outline" size={13} color={colors.foreground} />
          <Text style={styles.scheduleText}>{dueLabel ? `Due ${dueLabel}` : 'Set due date'}</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.scheduleButton, pressed && styles.pressed]}
          onPress={() => Alert.alert('Schedule', 'Scheduling coming soon.')}
        >
          <Ionicons name="time-outline" size={13} color={colors.foreground} />
          <Text style={styles.scheduleText}>Add schedule</Text>
        </Pressable>
      </View>

      {executedObjectives.length > 0 && (
        <View style={styles.objectivesBlock}>
          {executedObjectives.map(obj => {
            const expanded = expandedObjectiveIds.includes(obj.id);
            return (
              <View key={obj.id} style={styles.objectiveRow}>
                <Pressable
                  onPress={() => toggleObjectiveExpanded(obj.id)}
                  style={({ pressed }) => [styles.objectiveRowHeader, pressed && styles.pressed]}
                >
                  <View style={styles.objectiveStatusIcon}>
                    <Ionicons
                      name={obj.state === 'complete' ? 'checkmark-circle' : 'radio-button-on'}
                      size={16}
                      color={objectiveStateColors[obj.state] ?? colors.mutedForeground}
                    />
                  </View>
                  <Text style={styles.objectiveTitleText} numberOfLines={expanded ? undefined : 1}>
                    {obj.title ?? obj.objective}
                  </Text>
                  <Pressable hitSlop={6} onPress={() => toggleObjectiveExpanded(obj.id)}>
                    <Ionicons name="ellipsis-horizontal" size={16} color={colors.mutedForeground} />
                  </Pressable>
                </Pressable>
                {expanded && obj.title && obj.objective && (
                  <Text style={styles.objectiveBody}>{obj.objective}</Text>
                )}
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.draftBlock}>
        <TextInput
          style={styles.draftInput}
          value={objectiveDraft}
          onChangeText={setObjectiveDraft}
          placeholder="Click to add an objective..."
          placeholderTextColor={colors.mutedForeground}
          multiline
          textAlignVertical="top"
        />
        {canSaveObjective && (
          <Pressable
            onPress={onSaveObjective}
            style={({ pressed }) => [styles.saveObjective, pressed && styles.pressed]}
          >
            {savingObjective ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Text style={styles.saveObjectiveText}>{objectiveActionLabel}</Text>
            )}
          </Pressable>
        )}
      </View>

      <View style={styles.runSection}>
        <Pressable
          onPress={promptForServerLaunch}
          disabled={
            loadingServers ||
            launchingServerId !== null ||
            !isSSHSupported ||
            !resolvedAssignedSelection
          }
          style={({ pressed }) => [
            styles.launchServerButton,
            (loadingServers ||
              launchingServerId !== null ||
              !isSSHSupported ||
              !resolvedAssignedSelection) &&
              styles.launchServerButtonDisabled,
            pressed && styles.pressed
          ]}
        >
          {loadingServers || launchingServerId !== null ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <Ionicons name="terminal-outline" size={14} color={colors.primaryForeground} />
          )}
          <Text style={styles.launchServerButtonText}>
            {launchingServerId !== null
              ? 'Starting Remote Session…'
              : loadingServers
                ? 'Loading Servers…'
                : 'Run on Server'}
          </Text>
        </Pressable>
        {!isSSHSupported && (
          <Text style={styles.runHint}>Remote SSH launch is currently available on iOS only.</Text>
        )}
        {isSSHSupported && availableServers.length === 0 && (
          <Text style={styles.runHint}>
            {allServers.length > 0
              ? 'No connected SSH servers on this device.'
              : 'Add a server from the Servers tab to launch remotely.'}
          </Text>
        )}
      </View>

      <CollapsibleSection label="DOCUMENTS" open={showDocuments} onToggle={onToggleDocuments}>
        <DocumentAttachmentsSection
          documents={documents}
          uploading={uploadingDocument}
          onPickFile={onPickFile}
          onOpenDocument={onOpenDocument}
        />
        {ticketContext.trim() !== '' && (
          <View style={styles.docBlock}>
            <Text style={styles.docLabel}>Context</Text>
            <Text style={styles.docBody}>{ticketContext}</Text>
          </View>
        )}
        {ticketConstraints.trim() !== '' && (
          <View style={styles.docBlock}>
            <Text style={styles.docLabel}>Constraints</Text>
            <Text style={styles.docBody}>{ticketConstraints}</Text>
          </View>
        )}
        {ticketAcceptanceCriteria && (
          <View style={styles.docBlock}>
            <Text style={styles.docLabel}>Acceptance Criteria</Text>
            <Text style={styles.docBody}>{ticketAcceptanceCriteria}</Text>
          </View>
        )}
        {ticketContext.trim() === '' &&
          ticketConstraints.trim() === '' &&
          !ticketAcceptanceCriteria &&
          documents.length === 0 && <Text style={styles.docEmpty}>No documents attached.</Text>}
      </CollapsibleSection>

      <CollapsibleSection
        label="ACCEPTANCE CRITERIA"
        open={showAcceptanceCriteria}
        onToggle={onToggleAcceptanceCriteria}
      >
        <TextInput
          style={styles.criteriaInput}
          value={acceptanceCriteriaDraft}
          onChangeText={setAcceptanceCriteriaDraft}
          placeholder="Define completion criteria for this ticket..."
          placeholderTextColor={colors.mutedForeground}
          multiline
          textAlignVertical="top"
        />
        {canSaveAcceptanceCriteria && (
          <Pressable
            style={({ pressed }) => [
              styles.saveCriteriaButton,
              savingAcceptanceCriteria && styles.documentActionButtonDisabled,
              pressed && styles.pressed
            ]}
            onPress={() => onSaveAcceptanceCriteria()}
            disabled={savingAcceptanceCriteria}
          >
            {savingAcceptanceCriteria ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Text style={styles.saveCriteriaButtonText}>Save acceptance criteria</Text>
            )}
          </Pressable>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        label="CLI QUICKSTART"
        open={showCliQuickstart}
        onToggle={onToggleCliQuickstart}
      >
        <Pressable
          style={({ pressed }) => [styles.cliCopy, pressed && styles.pressed]}
          onPress={onCopyCliCommand}
        >
          <Text style={styles.cliText} selectable>
            ovld protocol attach --ticket-id {ticketId}
          </Text>
          <Ionicons name="copy-outline" size={14} color={colors.mutedForeground} />
        </Pressable>
        <Text style={styles.cliHint}>
          Paste in a terminal already authenticated with Overlord to attach this session.
        </Text>
      </CollapsibleSection>

      <View style={styles.activityHeader}>
        <Text style={styles.sectionLabel}>ACTIVITY</Text>
        <Pressable
          style={({ pressed }) => [styles.activityFilter, pressed && styles.pressed]}
          onPress={onToggleActivityFilter}
        >
          <Text style={styles.activityFilterText}>
            {activityFilter === 'completed' ? 'Completed' : 'All'}
          </Text>
          <Ionicons name="chevron-down" size={12} color={colors.mutedForeground} />
        </Pressable>
      </View>
      {filteredEvents.length === 0 ? (
        <Text style={styles.noActivity}>No activity yet</Text>
      ) : (
        filteredEvents.map(event => {
          const isFollowUp = event.event_type === 'user_follow_up';
          const profile = isFollowUp && event.created_by ? eventProfiles[event.created_by] : null;
          const icon = eventIcons[event.event_type] ?? {
            name: 'ellipse',
            color: colors.primary
          };
          const label = eventLabels[event.event_type] ?? event.event_type.replace(/_/g, ' ');
          return (
            <View
              key={event.id}
              style={[styles.eventRow, event.is_blocking && styles.eventBlocking]}
            >
              {isFollowUp ? (
                <View style={styles.eventAvatarBadge}>
                  {profile?.image_url ? (
                    <Image source={{ uri: profile.image_url }} style={styles.eventAvatarImage} />
                  ) : (
                    <Text style={styles.eventAvatarInitials}>
                      {(profile?.name ?? 'U').slice(0, 2).toUpperCase()}
                    </Text>
                  )}
                </View>
              ) : (
                <View style={styles.eventIconBadge}>
                  <Ionicons
                    name={icon.name as keyof typeof Ionicons.glyphMap}
                    size={12}
                    color={icon.color}
                  />
                </View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.eventHeader}>
                  <Text
                    style={[
                      styles.eventType,
                      isFollowUp && { color: '#f59e0b', fontWeight: '600' }
                    ]}
                  >
                    {isFollowUp && profile?.name ? profile.name : label}
                  </Text>
                  {event.phase && <Text style={styles.eventPhase}>{event.phase}</Text>}
                  <Text style={styles.eventTime}>
                    {new Date(event.created_at).toLocaleString(undefined, {
                      month: 'numeric',
                      day: 'numeric',
                      year: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit'
                    })}
                  </Text>
                </View>
                {event.summary && (
                  <Text style={styles.eventSummary} numberOfLines={4}>
                    {event.summary}
                  </Text>
                )}
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

function CollapsibleSection({
  label,
  open,
  onToggle,
  children
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.collapsible}>
      <Pressable
        style={({ pressed }) => [styles.collapsibleHeader, pressed && styles.pressed]}
        onPress={onToggle}
      >
        <Text style={styles.sectionLabel}>{label}</Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={colors.mutedForeground}
        />
      </Pressable>
      {open && <View style={styles.collapsibleBody}>{children}</View>}
    </View>
  );
}
