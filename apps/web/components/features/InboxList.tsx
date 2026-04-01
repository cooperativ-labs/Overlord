'use client';

import * as React from 'react';

import { Label } from '@/components/ui/label';
import { SidebarInput } from '@/components/ui/sidebar';
import { Switch } from '@/components/ui/switch';

// Sample data - replace with real data when connected to backend
const sampleMails = [
  {
    name: 'William Smith',
    email: 'williamsmith@example.com',
    subject: 'Meeting Tomorrow',
    date: '09:34 AM',
    teaser:
      'Hi team, just a reminder about our meeting tomorrow at 10 AM.\nPlease come prepared with your project updates.'
  },
  {
    name: 'Alice Smith',
    email: 'alicesmith@example.com',
    subject: 'Re: Project Update',
    date: 'Yesterday',
    teaser:
      "Thanks for the update. The progress looks great so far.\nLet's schedule a call to discuss the next steps."
  },
  {
    name: 'Bob Johnson',
    email: 'bobjohnson@example.com',
    subject: 'Weekend Plans',
    date: '2 days ago',
    teaser:
      "Hey everyone! I'm thinking of organizing a team outing this weekend.\nWould you be interested in a hiking trip or a beach day?"
  },
  {
    name: 'Emily Davis',
    email: 'emilydavis@example.com',
    subject: 'Re: Question about Budget',
    date: '2 days ago',
    teaser:
      "I've reviewed the budget numbers you sent over.\nCan we set up a quick call to discuss some potential adjustments?"
  },
  {
    name: 'Michael Wilson',
    email: 'michaelwilson@example.com',
    subject: 'Important Announcement',
    date: '1 week ago',
    teaser:
      "Please join us for an all-hands meeting this Friday at 3 PM.\nWe have some exciting news to share about the company's future."
  }
];

export function InboxList() {
  const [mails] = React.useState(sampleMails);

  return (
    <div className="bg-sidebar text-sidebar-foreground flex h-full w-80 shrink-0 flex-col border-r">
      <div className="flex flex-col gap-3.5 border-b p-4">
        <div className="flex w-full items-center justify-between">
          <div className="text-foreground text-base font-medium">Inbox</div>
          <Label className="flex items-center gap-2 text-sm">
            <span>Unreads</span>
            <Switch className="shadow-none" />
          </Label>
        </div>
        <SidebarInput placeholder="Type to search..." />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {mails.map(mail => (
          <a
            href="#"
            key={mail.email}
            className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex flex-col items-start gap-2 border-b p-4 text-sm leading-tight whitespace-nowrap last:border-b-0"
          >
            <div className="flex w-full items-center gap-2">
              <span>{mail.name}</span> <span className="ml-auto text-xs">{mail.date}</span>
            </div>
            <span className="font-medium">{mail.subject}</span>
            <span className="line-clamp-2 w-[260px] whitespace-break-spaces text-xs">
              {mail.teaser}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
