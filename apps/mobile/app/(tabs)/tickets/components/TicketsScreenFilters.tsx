import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import { useThemeColors, useThemedStyles } from '@/lib/colors';

import { FilterChip } from './FilterChip';
import {
  ALL_PROJECTS_LABEL,
  sortLabels,
  type SortMode,
  type StatusFilter,
  statusFilterLabels,
  type ViewMode
} from './shared';
import { createTicketsScreenStyles } from './TicketsScreenStyles';
import { ViewModeMenuButton } from './ViewModeMenuButton';

type TicketsScreenFiltersProps = {
  projectName: string;
  projectColor: string;
  viewMode: ViewMode;
  viewMenuOpen: boolean;
  showViewMenu: boolean;
  projectMenuOpen: boolean;
  sortMenuOpen: boolean;
  statusMenuOpen: boolean;
  sortMode: SortMode;
  statusFilter: StatusFilter;
  projects: { id: string; name: string; color: string }[];
  filterProjectId: string | null;
  onToggleProjectMenu: () => void;
  onToggleSortMenu: () => void;
  onToggleStatusMenu: () => void;
  onToggleViewMenu: () => void;
  onSelectView: (mode: ViewMode) => void;
  onSelectProject: (projectId: string | null) => void;
  onSelectSort: (mode: SortMode) => void;
  onSelectStatus: (filter: StatusFilter) => void;
};

export function TicketsScreenFilters({
  projectName,
  projectColor,
  viewMode,
  viewMenuOpen,
  showViewMenu,
  projectMenuOpen,
  sortMenuOpen,
  statusMenuOpen,
  sortMode,
  statusFilter,
  projects,
  filterProjectId,
  onToggleProjectMenu,
  onToggleSortMenu,
  onToggleStatusMenu,
  onToggleViewMenu,
  onSelectView,
  onSelectProject,
  onSelectSort,
  onSelectStatus
}: TicketsScreenFiltersProps) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createTicketsScreenStyles);

  return (
    <>
      <View style={styles.projectHeader}>
        <View style={[styles.projectSquare, { backgroundColor: projectColor }]} />
        <Text style={styles.projectHeaderName} numberOfLines={1}>
          {projectName}
        </Text>
        <Pressable
          hitSlop={8}
          style={styles.projectFilterButton}
          onPress={onToggleProjectMenu}
          accessibilityLabel="Filter by project"
        >
          <Ionicons name="chevron-down" size={16} color={colors.mutedForeground} />
        </Pressable>
      </View>
      {projectMenuOpen && (
        <View style={styles.menu}>
          <Pressable style={styles.menuItem} onPress={() => onSelectProject(null)}>
            <Text style={styles.menuItemText}>{ALL_PROJECTS_LABEL}</Text>
            {filterProjectId === null && (
              <Ionicons name="checkmark" size={14} color={colors.primary} />
            )}
          </Pressable>
          {projects.map(project => (
            <Pressable
              key={project.id}
              style={styles.menuItem}
              onPress={() => onSelectProject(project.id)}
            >
              <View style={styles.projectMenuLabel}>
                <View style={[styles.projectMenuDot, { backgroundColor: project.color }]} />
                <Text style={styles.menuItemText}>{project.name}</Text>
              </View>
              {filterProjectId === project.id && (
                <Ionicons name="checkmark" size={14} color={colors.primary} />
              )}
            </Pressable>
          ))}
        </View>
      )}
      <View style={styles.filterRow}>
        <View style={styles.filterChips}>
          <FilterChip
            icon="swap-vertical-outline"
            label={sortLabels[sortMode]}
            onPress={onToggleSortMenu}
            active={sortMenuOpen}
          />
          <FilterChip
            icon="funnel-outline"
            label={statusFilterLabels[statusFilter]}
            onPress={onToggleStatusMenu}
            active={statusMenuOpen}
          />
        </View>
        {showViewMenu && (
          <View style={styles.viewMenuWrap}>
            <ViewModeMenuButton
              value={viewMode}
              open={viewMenuOpen}
              onPress={onToggleViewMenu}
              onSelect={onSelectView}
            />
          </View>
        )}
      </View>

      {sortMenuOpen && (
        <View style={styles.menu}>
          {(Object.keys(sortLabels) as SortMode[]).map(mode => (
            <Pressable key={mode} style={styles.menuItem} onPress={() => onSelectSort(mode)}>
              <Text style={styles.menuItemText}>{sortLabels[mode]}</Text>
              {sortMode === mode && <Ionicons name="checkmark" size={14} color={colors.primary} />}
            </Pressable>
          ))}
        </View>
      )}

      {statusMenuOpen && (
        <View style={styles.menu}>
          {(Object.keys(statusFilterLabels) as StatusFilter[]).map(filter => (
            <Pressable key={filter} style={styles.menuItem} onPress={() => onSelectStatus(filter)}>
              <Text style={styles.menuItemText}>{statusFilterLabels[filter]}</Text>
              {statusFilter === filter && (
                <Ionicons name="checkmark" size={14} color={colors.primary} />
              )}
            </Pressable>
          ))}
        </View>
      )}
    </>
  );
}
