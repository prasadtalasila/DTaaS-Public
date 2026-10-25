// escalation and presence are sent by 06 and 07
export type NotifyKind = 'state' | 'escalation' | 'presence';

// The envelope of every notification, over MQTT and the webhook; for a
// state notification, time is the time of the state document
export type NotificationDto = {
  kind: NotifyKind;
  id: string;
  time: string;
  data: unknown;
};
