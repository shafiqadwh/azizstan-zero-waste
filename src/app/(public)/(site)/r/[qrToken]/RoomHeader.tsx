import type { RoomHub } from '@/server/services/room-hub.service';

/** The green room card shared by the hub and its service pages. */
export function RoomHeader({ hub }: { hub: RoomHub }) {
  const place = [hub.building, hub.floor != null ? `ชั้น ${hub.floor}` : null].filter(Boolean).join(' ');
  return (
    <header className="rounded-[18px] bg-brand px-5 py-5 text-white" data-testid="room-hub-header">
      <p className="text-[14px] opacity-90">ห้อง</p>
      <h1 className="text-[40px] leading-tight font-bold">{hub.roomNumber}</h1>
      {hub.classLabel ? <p className="text-[18px] font-semibold">{hub.classLabel}</p> : null}
      {place ? <p className="text-[14px] opacity-90">{place}</p> : null}
    </header>
  );
}
