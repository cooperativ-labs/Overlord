'use client';

import { createContext, useContext, useState } from 'react';

type TicketViewContextValue = {
  activeView: string;
  setActiveView: (view: string) => void;
};

export const TicketViewContext = createContext<TicketViewContextValue>({
  activeView: 'board',
  setActiveView: () => {}
});

export function TicketViewProvider({
  initialView,
  children
}: {
  initialView: string;
  children: React.ReactNode;
}) {
  const [activeView, setActiveView] = useState(initialView);
  return (
    <TicketViewContext.Provider value={{ activeView, setActiveView }}>
      {children}
    </TicketViewContext.Provider>
  );
}

export function useTicketView() {
  return useContext(TicketViewContext);
}
