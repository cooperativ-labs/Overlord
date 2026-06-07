'use client';

import { useState, useTransition } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import type { OrganizationMember } from '@/lib/actions/organizations';
import { setTicketAssignedMemberAction } from '@/lib/actions/tickets';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';

const UNASSIGNED_VALUE = '__unassigned__';
const setTicketAssignedMemberActionWithRetry = withElectronActionRetry(
  setTicketAssignedMemberAction
);

type TicketMemberSelectProps = {
  ticketId: string;
  members: OrganizationMember[];
  currentAssignedMember: string | null;
};

function memberLabel(member: OrganizationMember): string {
  return member.displayName?.trim() || member.username || member.email || 'Member';
}

function memberInitials(member: OrganizationMember): string {
  const source = memberLabel(member);
  return source.slice(0, 2).toUpperCase();
}

export function TicketMemberSelect({
  ticketId,
  members,
  currentAssignedMember
}: TicketMemberSelectProps) {
  const [savedMemberId, setSavedMemberId] = useState<string | null>(currentAssignedMember);
  const [selectedValue, setSelectedValue] = useState<string>(
    currentAssignedMember ?? UNASSIGNED_VALUE
  );
  const [isSaving, startSaving] = useTransition();
  const [updateError, setUpdateError] = useState<string | null>(null);

  function handleChange(nextValue: string) {
    const previousValue = savedMemberId ?? UNASSIGNED_VALUE;
    const nextMemberId = nextValue === UNASSIGNED_VALUE ? null : nextValue;
    setSelectedValue(nextValue);
    setUpdateError(null);

    startSaving(async () => {
      try {
        await setTicketAssignedMemberActionWithRetry(ticketId, nextMemberId);
        setSavedMemberId(nextMemberId);
      } catch (error) {
        setSelectedValue(previousValue);
        setUpdateError(error instanceof Error ? error.message : 'Failed to update assignee.');
      }
    });
  }

  return (
    <div className="flex flex-col">
      <Select value={selectedValue} onValueChange={handleChange} disabled={isSaving}>
        <SelectTrigger aria-label="Assignee" className="h-7 w-auto gap-1.5 px-2 text-xs">
          <SelectValue placeholder="Unassigned" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
          {members.map(member => (
            <SelectItem key={member.memberId} value={member.memberId}>
              <span className="flex items-center gap-2">
                <Avatar className="h-4 w-4">
                  {member.imageUrl ? (
                    <AvatarImage src={member.imageUrl} alt={memberLabel(member)} />
                  ) : null}
                  <AvatarFallback className="text-[8px]">{memberInitials(member)}</AvatarFallback>
                </Avatar>
                <span className="truncate">{memberLabel(member)}</span>
                {member.username ? (
                  <span className="text-muted-foreground">@{member.username}</span>
                ) : null}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {updateError ? <p className="text-xs text-destructive">{updateError}</p> : null}
    </div>
  );
}
