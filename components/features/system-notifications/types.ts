export type SystemNotificationType = 'update' | 'warning' | 'info';

export type SystemNotification = {
  id: string;
  type: SystemNotificationType;
  title: string;
  message: string;
  /** Optional action button */
  action?: {
    label: string;
    onClick: () => void;
  };
  /** If set, dismissal is persisted in localStorage under this key */
  dismissKey?: string;
};
