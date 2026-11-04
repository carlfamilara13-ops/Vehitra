import type { NotificationResponse } from 'expo-notifications';
import { getDb } from '../../data/local/db';
import { handleStationaryRideAction } from './stationaryRide';

export async function handleLocalNotificationResponse(response: NotificationResponse): Promise<void> {
  const data = response.notification.request.content.data as Record<string, unknown> | undefined;
  if (data?.type !== 'stationary_ride' || typeof data.rideId !== 'string') return;
  await handleStationaryRideAction(
    await getDb(),
    data.rideId,
    response.actionIdentifier,
    response.notification.request.identifier,
  );
}
